import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { changeRequests, invoices, messages, milestones, organizations, projectFiles, projects, users, type DbOrTx } from "@workspace/db";
import { canStartWork, changeRequestMachine, hasPermission, milestoneMachine, projectMachine, PROJECT_STATUS_LABELS, type ProjectStatus } from "@workspace/domain";
import {
  changeRequestBody,
  changeRequestDecisionBody,
  changeRequestUpdateBody,
  depositExceptionBody,
  messageBody,
  milestoneBody,
  milestoneUpdateBody,
  projectCreateBody,
  projectUpdateBody,
} from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, notFound } from "../lib/errors";
import { nextNumber } from "../lib/db-helpers";
import { audit, track } from "../services/audit";
import { assertOrgAccess, userOrganizationIds } from "../services/accounts";
import { invoiceBalance, issueInvoice } from "../services/invoicing";
import type { AuthInfo } from "../middleware/session";
import { requireVerifiedClient } from "./portal";
import type { AppContext } from "../context";

const idParams = z.object({ id: z.uuid() });
const msParams = z.object({ id: z.uuid(), milestoneId: z.uuid() });

function projectScope(auth: AuthInfo) {
  if (hasPermission(auth.user.role, "projects.read_all")) return undefined;
  return eq(projects.managerId, auth.user.id);
}

async function orgMemberIds(tx: DbOrTx, organizationId: string): Promise<string[]> {
  const rows = await tx.execute<{ user_id: string }>(sql`select user_id from organization_members where organization_id = ${organizationId}`);
  return rows.rows.map((r) => r.user_id);
}

async function depositPaid(tx: DbOrTx, p: typeof projects.$inferSelect): Promise<boolean> {
  if (p.depositPaidAt) return true;
  if (!p.depositInvoiceId) return false;
  const [inv] = await tx.select().from(invoices).where(eq(invoices.id, p.depositInvoiceId));
  return inv?.status === "paid";
}

/** Client-safe project projection: internal milestones and notes are excluded. */
async function clientProjectView(app: AppContext, p: typeof projects.$inferSelect) {
  const [ms, files, crs, updates, invs] = await Promise.all([
    app.db.select().from(milestones).where(and(eq(milestones.projectId, p.id), eq(milestones.visibility, "client"))).orderBy(asc(milestones.displayOrder)),
    app.db
      .select({ id: projectFiles.id, fileName: projectFiles.fileName, mimeType: projectFiles.mimeType, sizeBytes: projectFiles.sizeBytes, kind: projectFiles.kind, description: projectFiles.description, createdAt: projectFiles.createdAt, approvedAt: projectFiles.approvedAt })
      .from(projectFiles)
      .where(and(eq(projectFiles.projectId, p.id), eq(projectFiles.visibility, "client"), sql`${projectFiles.deletedAt} is null`))
      .orderBy(desc(projectFiles.createdAt)),
    app.db.select().from(changeRequests).where(eq(changeRequests.projectId, p.id)).orderBy(desc(changeRequests.createdAt)),
    app.db
      .select({ id: messages.id, kind: messages.kind, body: messages.body, createdAt: messages.createdAt, authorName: users.name, authorRole: users.role })
      .from(messages)
      .leftJoin(users, eq(users.id, messages.authorId))
      .where(and(eq(messages.threadType, "project"), eq(messages.threadId, p.id), eq(messages.internal, false)))
      .orderBy(desc(messages.createdAt))
      .limit(100),
    app.db.select().from(invoices).where(and(eq(invoices.projectId, p.id), ne(invoices.status, "void"))),
  ]);
  const paidToDate = invs.reduce((s, i) => s + i.amountPaidMinor - i.amountRefundedMinor, 0);
  const nextUnpaid = invs.filter((i) => invoiceBalance(i) > 0).sort((a, b) => (a.dueAt?.getTime() ?? 0) - (b.dueAt?.getTime() ?? 0))[0];
  return {
    project: {
      id: p.id,
      reference: p.reference,
      name: p.name,
      summary: p.summary,
      status: p.status,
      statusLabel: PROJECT_STATUS_LABELS[p.status],
      progressPct: p.progressPct,
      startDate: p.startDate,
      targetDate: p.targetDate,
      completedAt: p.completedAt,
      depositRequired: p.depositRequired,
      depositPaid: Boolean(p.depositPaidAt),
      depositInvoiceId: p.depositInvoiceId,
    },
    finance: {
      contractValueMinor: p.contractValueMinor,
      paidToDateMinor: paidToDate,
      balanceMinor: Math.max(0, p.contractValueMinor - paidToDate),
      nextPayment: nextUnpaid ? { invoiceId: nextUnpaid.id, number: nextUnpaid.number, amountMinor: invoiceBalance(nextUnpaid), dueAt: nextUnpaid.dueAt } : null,
    },
    milestones: ms.map((m) => ({ id: m.id, key: m.key, title: m.title, description: m.description, status: m.status, amountMinor: m.amountMinor, billable: m.billable, invoiceId: m.invoiceId, targetDate: m.targetDate, completedAt: m.completedAt, clientApprovedAt: m.clientApprovedAt })),
    files,
    changeRequests: crs.map((c) => ({ id: c.id, reference: c.reference, type: c.type, title: c.title, description: c.description, priority: c.priority, status: c.status, impactEstimateMinor: c.impactEstimateMinor, impactDays: c.impactDays, response: c.response, createdAt: c.createdAt, clientDecisionAt: c.clientDecisionAt })),
    updates: updates.map((u) => ({ ...u, fromStudio: u.authorRole !== "client" })),
  };
}

export function adminProjectRoutes(app: AppContext): RouteDef[] {
  async function load(auth: AuthInfo, id: string) {
    const [p] = await app.db.select().from(projects).where(and(eq(projects.id, id), projectScope(auth)));
    if (!p) throw notFound("Project");
    return p;
  }
  const readPerm = ["projects.read_all", "projects.read_assigned"] as const;
  return [
    defineRoute({
      method: "get",
      path: "/admin/projects",
      summary: "Projects (staff see projects they manage)",
      tags: ["admin:projects"],
      auth: "staff",
      permission: [...readPerm],
      query: z.object({ status: z.string().max(30).optional() }),
      handler: async ({ auth, query }) => {
        const a = requireUser(auth);
        const rows = await app.db
          .select({ p: projects, orgName: organizations.name, managerName: users.name })
          .from(projects)
          .innerJoin(organizations, eq(organizations.id, projects.organizationId))
          .leftJoin(users, eq(users.id, projects.managerId))
          .where(and(projectScope(a), query.status ? eq(projects.status, query.status as ProjectStatus) : undefined))
          .orderBy(desc(projects.updatedAt));
        return rows.map((r) => ({ ...r.p, client: r.orgName, managerName: r.managerName }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/projects/:id",
      summary: "Project with milestones, files, change requests, updates and internal notes",
      tags: ["admin:projects"],
      auth: "staff",
      permission: [...readPerm],
      params: idParams,
      handler: async ({ params, auth }) => {
        const p = await load(requireUser(auth), params.id);
        const [ms, files, crs, thread, invs, org] = await Promise.all([
          app.db.select().from(milestones).where(eq(milestones.projectId, p.id)).orderBy(asc(milestones.displayOrder)),
          app.db.select().from(projectFiles).where(and(eq(projectFiles.projectId, p.id), sql`${projectFiles.deletedAt} is null`)).orderBy(desc(projectFiles.createdAt)),
          app.db.select().from(changeRequests).where(eq(changeRequests.projectId, p.id)).orderBy(desc(changeRequests.createdAt)),
          app.db
            .select({ m: messages, authorName: users.name, authorRole: users.role })
            .from(messages)
            .leftJoin(users, eq(users.id, messages.authorId))
            .where(and(eq(messages.threadType, "project"), eq(messages.threadId, p.id)))
            .orderBy(desc(messages.createdAt)),
          app.db.select().from(invoices).where(eq(invoices.projectId, p.id)),
          app.db.select().from(organizations).where(eq(organizations.id, p.organizationId)),
        ]);
        return {
          project: { ...p, depositPaid: await depositPaid(app.db, p), canStartWork: canStartWork({ depositRequired: p.depositRequired, depositPaid: await depositPaid(app.db, p), depositExceptionReason: p.depositExceptionReason }), nextStatuses: projectMachine.next(p.status) },
          organization: org[0],
          milestones: ms,
          files,
          changeRequests: crs,
          thread: thread.map((r) => ({ ...r.m, authorName: r.authorName, authorRole: r.authorRole })),
          invoices: invs.map((i) => ({ ...i, balanceMinor: invoiceBalance(i) })),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/projects",
      summary: "Create a project manually (e.g. retainer work)",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.manage",
      body: projectCreateBody,
      successStatus: 201,
      handler: async ({ body, req }) => {
        return app.db.transaction(async (tx) => {
          const reference = await nextNumber(tx, "PRJ");
          const [p] = await tx
            .insert(projects)
            .values({ ...body, reference, targetDate: body.targetDate ? new Date(body.targetDate) : null, status: body.depositRequired ? "awaiting_deposit" : "not_started" })
            .returning();
          await audit(tx, req, { action: "project.created", entityType: "project", entityId: p.id, after: { reference } });
          return p;
        });
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/projects/:id",
      summary: "Update project status/details. Moving to in_progress requires a paid deposit or an approved exception.",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.manage",
      params: idParams,
      body: projectUpdateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const p = await load(a, params.id);
        return app.db.transaction(async (tx) => {
          const patch: Partial<typeof projects.$inferInsert> = {};
          if (body.name !== undefined) patch.name = body.name;
          if (body.summary !== undefined) patch.summary = body.summary;
          if (body.progressPct !== undefined) patch.progressPct = body.progressPct;
          if (body.startDate !== undefined) patch.startDate = body.startDate ? new Date(body.startDate) : null;
          if (body.targetDate !== undefined) patch.targetDate = body.targetDate ? new Date(body.targetDate) : null;
          if (body.managerId !== undefined) {
            if (body.managerId) {
              const [m] = await tx.select({ role: users.role }).from(users).where(eq(users.id, body.managerId));
              if (!m || m.role === "client") throw new AppError(422, "validation_failed", "Project managers must be staff.");
            }
            patch.managerId = body.managerId;
          }
          if (body.status && body.status !== p.status) {
            if (!projectMachine.can(p.status, body.status)) throw new AppError(422, "invalid_transition", `Can't move from ${PROJECT_STATUS_LABELS[p.status]} to ${PROJECT_STATUS_LABELS[body.status]}.`);
            if (body.status === "in_progress" && !canStartWork({ depositRequired: p.depositRequired, depositPaid: await depositPaid(tx, p), depositExceptionReason: p.depositExceptionReason })) {
              throw new AppError(422, "invalid_transition", "Work can't start until the deposit is paid, or an admin records an approved exception.");
            }
            patch.status = body.status;
            if (body.status === "in_progress" && !p.startDate) patch.startDate = new Date();
            if (body.status === "completed") {
              patch.completedAt = new Date();
              patch.progressPct = 100;
            }
          }
          const [u] = await tx.update(projects).set(patch).where(eq(projects.id, p.id)).returning();
          if (patch.status) {
            await tx.insert(messages).values({ threadType: "project", threadId: p.id, organizationId: p.organizationId, authorId: a.user.id, kind: "system", body: `Status changed to ${PROJECT_STATUS_LABELS[patch.status]}.` });
            for (const uid of await orgMemberIds(tx, p.organizationId)) {
              await app.notifications.queue(tx, { template: "project.update", userId: uid, category: "projectUpdates", data: { projectName: p.name, body: `Your project is now ${PROJECT_STATUS_LABELS[patch.status].toLowerCase()}.`, path: `/portal/projects/${p.id}` } });
            }
          }
          await audit(tx, req, { action: "project.updated", entityType: "project", entityId: p.id, before: { status: p.status, managerId: p.managerId }, after: { status: u.status, managerId: u.managerId } });
          return u;
        }).finally(() => void app.notifications.dispatchPending());
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/projects/:id/deposit-exception",
      summary: "Allow work to start before the deposit is paid (reason required; audited)",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.deposit_exception",
      params: idParams,
      body: depositExceptionBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const p = await load(a, params.id);
        const [u] = await app.db.update(projects).set({ depositExceptionReason: body.reason, depositExceptionById: a.user.id }).where(eq(projects.id, p.id)).returning();
        await audit(app.db, req, { action: "project.deposit_exception", entityType: "project", entityId: p.id, reason: body.reason });
        return u;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/projects/:id/milestones",
      summary: "Add a milestone",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.manage",
      params: idParams,
      body: milestoneBody,
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const p = await load(requireUser(auth), params.id);
        const [m] = await app.db.insert(milestones).values({ ...body, projectId: p.id, targetDate: body.targetDate ? new Date(body.targetDate) : null }).returning();
        return m;
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/projects/:id/milestones/:milestoneId",
      summary: "Update a milestone (status changes notify the client)",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.manage",
      params: msParams,
      body: milestoneUpdateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const p = await load(a, params.id);
        const [m] = await app.db.select().from(milestones).where(and(eq(milestones.id, params.milestoneId), eq(milestones.projectId, p.id)));
        if (!m) throw notFound("Milestone");
        if (m.invoiceId && body.amountMinor !== undefined && body.amountMinor !== m.amountMinor) throw new AppError(422, "unprocessable", "This milestone has been invoiced; its amount can't change.");
        return app.db.transaction(async (tx) => {
          const patch: Partial<typeof milestones.$inferInsert> = { ...body, targetDate: body.targetDate === undefined ? undefined : body.targetDate ? new Date(body.targetDate) : null };
          if (body.status && body.status !== m.status) {
            if (!milestoneMachine.can(m.status, body.status)) throw new AppError(422, "invalid_transition", "Invalid milestone status change.");
            if (body.status === "completed") patch.completedAt = new Date();
          }
          const [u] = await tx.update(milestones).set(patch).where(eq(milestones.id, m.id)).returning();
          if (body.status && body.status !== m.status && u.visibility === "client") {
            if (body.status === "completed") await track(tx, "project_milestone_completed", { entityType: "milestone", entityId: m.id });
            for (const uid of await orgMemberIds(tx, p.organizationId)) {
              await app.notifications.queue(tx, {
                template: body.status === "completed" ? "project.milestone_completed" : "project.update",
                userId: uid,
                category: "projectUpdates",
                data: { projectName: p.name, milestone: u.title, body: `Milestone “${u.title}” is now ${body.status.replace("_", " ")}.`, path: `/portal/projects/${p.id}` },
              });
            }
          }
          await audit(tx, req, { action: "milestone.updated", entityType: "milestone", entityId: m.id, before: { status: m.status }, after: { status: u.status } });
          return u;
        }).finally(() => void app.notifications.dispatchPending());
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/projects/:id/milestones/:milestoneId/invoice",
      summary: "Issue the invoice for a billable milestone",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "invoices.manage",
      params: msParams,
      body: z.object({ dueInDays: z.number().int().min(0).max(120).optional() }),
      successStatus: 201,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const [p] = await app.db.select().from(projects).where(eq(projects.id, params.id));
        if (!p) throw notFound("Project");
        const inv = await app.db.transaction(async (tx) => {
          const locked = await tx.execute(sql`select id from milestones where id = ${params.milestoneId} and project_id = ${p.id} for update`);
          if (!locked.rows.length) throw notFound("Milestone");
          const [m] = await tx.select().from(milestones).where(eq(milestones.id, params.milestoneId));
          if (m.invoiceId) throw new AppError(409, "conflict", "This milestone has already been invoiced.");
          if (!m.billable || m.amountMinor <= 0) throw new AppError(422, "unprocessable", "This milestone isn't billable.");
          let tax;
          if (p.proposalId) {
            const r = await tx.execute<{ tax_snapshot: { enabled: boolean; rateBps: number; label: string; pricesIncludeTax: boolean } | null }>(sql`select tax_snapshot from proposals where id = ${p.proposalId}`);
            tax = r.rows[0]?.tax_snapshot ?? undefined;
          }
          const i = await issueInvoice(app, tx, {
            organizationId: p.organizationId,
            orderId: p.orderId,
            projectId: p.id,
            milestoneId: m.id,
            kind: "milestone",
            amounts: { mode: "gross", description: `${m.title} — ${p.name} (${p.reference})`, grossMinor: m.amountMinor },
            dueInDays: body.dueInDays,
            tax,
            createdById: a.user.id,
          });
          await tx.update(milestones).set({ invoiceId: i.id }).where(eq(milestones.id, m.id));
          await audit(tx, req, { action: "invoice.issued", entityType: "invoice", entityId: i.id, after: { number: i.number, milestone: m.key } });
          for (const uid of await orgMemberIds(tx, p.organizationId)) {
            await app.notifications.queue(tx, { template: "invoice.issued", userId: uid, category: "invoices", data: { number: i.number, amountMinor: i.totalMinor, description: m.title, dueDate: i.dueAt?.toISOString().slice(0, 10), path: `/portal/invoices/${i.id}` }, dedupeKey: `invoice-issued:${i.id}:${uid}` });
          }
          return i;
        });
        void app.notifications.dispatchPending();
        return inv;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/projects/:id/messages",
      summary: "Post a client update or an internal note",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "projects.manage",
      params: idParams,
      body: messageBody,
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const a = requireUser(auth);
        const p = await load(a, params.id);
        const m = await app.db.transaction(async (tx) => {
          const [row] = await tx.insert(messages).values({ threadType: "project", threadId: p.id, organizationId: p.organizationId, authorId: a.user.id, kind: body.kind, body: body.body, internal: body.internal }).returning();
          if (!body.internal) {
            for (const uid of await orgMemberIds(tx, p.organizationId)) {
              await app.notifications.queue(tx, { template: "project.update", userId: uid, category: "projectUpdates", data: { projectName: p.name, body: body.body, path: `/portal/projects/${p.id}` } });
            }
          }
          return row;
        });
        void app.notifications.dispatchPending();
        return m;
      },
    }),
    // ------------------------------------------------------------ change requests (admin)
    defineRoute({
      method: "get",
      path: "/admin/change-requests",
      summary: "Support tickets and change requests",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "requests.manage",
      query: z.object({ status: z.string().max(20).optional(), type: z.string().max(20).optional() }),
      handler: async ({ query }) =>
        app.db
          .select({ c: changeRequests, projectName: projects.name, client: organizations.name })
          .from(changeRequests)
          .innerJoin(projects, eq(projects.id, changeRequests.projectId))
          .innerJoin(organizations, eq(organizations.id, changeRequests.organizationId))
          .where(and(query.status ? eq(changeRequests.status, query.status as never) : undefined, query.type ? eq(changeRequests.type, query.type as never) : undefined))
          .orderBy(desc(changeRequests.createdAt))
          .limit(200)
          .then((rows) => rows.map((r) => ({ ...r.c, projectName: r.projectName, client: r.client }))),
    }),
    defineRoute({
      method: "patch",
      path: "/admin/change-requests/:id",
      summary: "Triage, quote, respond to or resolve a request",
      tags: ["admin:projects"],
      auth: "staff",
      permission: "requests.manage",
      params: idParams,
      body: changeRequestUpdateBody,
      handler: async ({ params, body, req }) => {
        const [c] = await app.db.select().from(changeRequests).where(eq(changeRequests.id, params.id));
        if (!c) throw notFound("Request");
        if (body.status && body.status !== c.status && !changeRequestMachine.can(c.status, body.status)) throw new AppError(422, "invalid_transition", "Invalid status change.");
        if (body.status === "quoted" && c.type === "defect") throw new AppError(422, "unprocessable", "Defects are fixed under warranty and are not quoted.");
        if (body.status === "quoted" && !(body.impactEstimateMinor ?? c.impactEstimateMinor)) throw new AppError(422, "validation_failed", "Add a price impact before sending a quote.");
        return app.db.transaction(async (tx) => {
          const [u] = await tx
            .update(changeRequests)
            .set({ ...body, resolvedAt: body.status === "resolved" ? new Date() : c.resolvedAt })
            .where(eq(changeRequests.id, c.id))
            .returning();
          if (c.submittedById && (body.status || body.response)) {
            await app.notifications.queue(tx, { template: "change_request.updated", userId: c.submittedById, category: "projectUpdates", data: { reference: c.reference, title: c.title, status: u.status.replace("_", " "), response: body.response, path: `/portal/projects/${c.projectId}` } });
          }
          await audit(tx, req, { action: "change_request.updated", entityType: "change_request", entityId: c.id, before: { status: c.status }, after: { status: u.status, impactEstimateMinor: u.impactEstimateMinor } });
          return u;
        }).finally(() => void app.notifications.dispatchPending());
      },
    }),
  ];
}

export function portalProjectRoutes(app: AppContext): RouteDef[] {
  async function load(userId: string, id: string) {
    const [p] = await app.db.select().from(projects).where(eq(projects.id, id));
    if (!p) throw notFound("Project");
    await assertOrgAccess(app.db, userId, p.organizationId, "Project");
    return p;
  }
  return [
    defineRoute({
      method: "get",
      path: "/portal/projects",
      summary: "My projects",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        const rows = await app.db.select().from(projects).where(inArray(projects.organizationId, orgIds)).orderBy(desc(projects.updatedAt));
        return rows.map((p) => ({ id: p.id, reference: p.reference, name: p.name, status: p.status, statusLabel: PROJECT_STATUS_LABELS[p.status], progressPct: p.progressPct, targetDate: p.targetDate, depositPaid: Boolean(p.depositPaidAt) }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/projects/:id",
      summary: "Project detail: milestones, finance summary, files, requests and updates",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      handler: async ({ params, auth }) => {
        const a = requireVerifiedClient(auth);
        return clientProjectView(app, await load(a.user.id, params.id));
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/projects/:id/milestones/:milestoneId/approve",
      summary: "Approve a milestone delivered for review",
      tags: ["portal"],
      auth: "user",
      params: msParams,
      handler: async ({ params, auth, req }) => {
        const a = requireVerifiedClient(auth);
        const p = await load(a.user.id, params.id);
        const [m] = await app.db.select().from(milestones).where(and(eq(milestones.id, params.milestoneId), eq(milestones.projectId, p.id), eq(milestones.visibility, "client")));
        if (!m) throw notFound("Milestone");
        if (m.status !== "awaiting_approval") throw new AppError(422, "invalid_transition", "This milestone isn't awaiting your approval.");
        const [u] = await app.db.update(milestones).set({ status: "completed", completedAt: new Date(), clientApprovedAt: new Date() }).where(eq(milestones.id, m.id)).returning();
        await audit(app.db, req, { action: "milestone.client_approved", entityType: "milestone", entityId: m.id });
        await track(app.db, "project_milestone_completed", { userId: a.user.id, entityType: "milestone", entityId: m.id });
        return u;
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/projects/:id/messages",
      summary: "Message the delivery team",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: z.object({ body: z.string().trim().min(1).max(10_000) }),
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const a = requireVerifiedClient(auth);
        const p = await load(a.user.id, params.id);
        const m = await app.db.transaction(async (tx) => {
          const [row] = await tx.insert(messages).values({ threadType: "project", threadId: p.id, organizationId: p.organizationId, authorId: a.user.id, body: body.body }).returning();
          if (p.managerId) await app.notifications.queue(tx, { template: "message.new", userId: p.managerId, data: { subject: `${p.name}`, body: body.body, path: `/admin/projects/${p.id}` } });
          else await app.notifications.queueStaff(tx, { template: "message.new", data: { subject: `${p.name}`, body: body.body, path: `/admin/projects/${p.id}` } });
          return row;
        });
        void app.notifications.dispatchPending();
        return { id: m.id, body: m.body, createdAt: m.createdAt };
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/change-requests",
      summary: "Submit a support ticket or change request (defects vs new scope)",
      tags: ["portal"],
      auth: "user",
      body: changeRequestBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireVerifiedClient(auth);
        const p = await load(a.user.id, body.projectId);
        const cr = await app.db.transaction(async (tx) => {
          const reference = await nextNumber(tx, "CR");
          const [c] = await tx.insert(changeRequests).values({ ...body, reference, organizationId: p.organizationId, submittedById: a.user.id }).returning();
          await audit(tx, req, { action: "change_request.submitted", entityType: "change_request", entityId: c.id });
          await track(tx, "change_request_submitted", { userId: a.user.id, entityType: "change_request", entityId: c.id, properties: { type: body.type } });
          const notify = { template: "change_request.submitted", data: { reference, type: body.type, title: body.title, description: body.description, path: `/admin/requests?focus=${c.id}` } };
          if (p.managerId) await app.notifications.queue(tx, { ...notify, userId: p.managerId });
          else await app.notifications.queueStaff(tx, notify);
          return c;
        });
        void app.notifications.dispatchPending();
        return cr;
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/change-requests",
      summary: "My requests across projects",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        return app.db
          .select({ c: changeRequests, projectName: projects.name })
          .from(changeRequests)
          .innerJoin(projects, eq(projects.id, changeRequests.projectId))
          .where(inArray(changeRequests.organizationId, orgIds))
          .orderBy(desc(changeRequests.createdAt))
          .then((rows) => rows.map((r) => ({ ...r.c, projectName: r.projectName })));
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/change-requests/:id/decision",
      summary: "Approve or reject a quoted change",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: changeRequestDecisionBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireVerifiedClient(auth);
        const [c] = await app.db.select().from(changeRequests).where(eq(changeRequests.id, params.id));
        if (!c) throw notFound("Request");
        await assertOrgAccess(app.db, a.user.id, c.organizationId, "Request");
        if (c.status !== "quoted") throw new AppError(422, "invalid_transition", "Only quoted changes need a decision.");
        const to = body.decision === "approve" ? "approved" : "rejected";
        const [u] = await app.db.update(changeRequests).set({ status: to, clientDecisionAt: new Date() }).where(eq(changeRequests.id, c.id)).returning();
        await audit(app.db, req, { action: `change_request.client_${to}`, entityType: "change_request", entityId: c.id, after: { impactEstimateMinor: c.impactEstimateMinor } });
        return u;
      },
    }),
  ];
}
