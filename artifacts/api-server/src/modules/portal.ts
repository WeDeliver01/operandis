import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { configuratorSubmissions, estimates, invoices, notifications, organizationMembers, organizations, projects, proposals, milestones, orders } from "@workspace/db";
import { isStaffRole, PROJECT_STATUS_LABELS } from "@workspace/domain";
import { addressSchema, okSchema } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, notFound } from "../lib/errors";
import { assertOrgAccess, userOrganizationIds } from "../services/accounts";
import { audit } from "../services/audit";
import { invoiceBalance, isOverdue } from "../services/invoicing";
import { buildEstimateView, estimateAccessToken } from "./configurator";
import type { AuthInfo } from "../middleware/session";
import type { AppContext } from "../context";

/**
 * Portal data requires a verified email. This prevents someone who registers
 * with another person's address from seeing records created for that address.
 */
export function requireVerifiedClient(auth: AuthInfo | null): AuthInfo {
  const a = requireUser(auth);
  if (!a.user.emailVerifiedAt && !isStaffRole(a.user.role)) {
    throw new AppError(403, "forbidden", "Please confirm your email address to access the client portal.");
  }
  return a;
}

export function portalRoutes(app: AppContext): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/portal/dashboard",
      summary: "Client overview: projects, next payment, balance, action-needed items and recent activity",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return { projects: [], actions: [], finance: { outstandingMinor: 0, overdueCount: 0, nextPayment: null }, upcomingMilestones: [], recent: [] };
        const [projs, invs, props, recent, subs] = await Promise.all([
          app.db.select().from(projects).where(inArray(projects.organizationId, orgIds)).orderBy(desc(projects.updatedAt)),
          app.db.select().from(invoices).where(and(inArray(invoices.organizationId, orgIds), inArray(invoices.status, ["issued", "partially_paid"]))),
          app.db
            .select()
            .from(proposals)
            .where(and(inArray(proposals.organizationId, orgIds), inArray(proposals.status, ["sent", "viewed"]))),
          app.db.select().from(notifications).where(and(eq(notifications.userId, a.user.id), eq(notifications.channel, "in_app"))).orderBy(desc(notifications.createdAt)).limit(8),
          app.db.select({ id: configuratorSubmissions.id }).from(configuratorSubmissions).where(inArray(configuratorSubmissions.organizationId, orgIds)),
        ]);
        const projectIds = projs.map((p) => p.id);
        const upcoming = projectIds.length
          ? await app.db
              .select({ m: milestones, projectName: projects.name })
              .from(milestones)
              .innerJoin(projects, eq(projects.id, milestones.projectId))
              .where(and(inArray(milestones.projectId, projectIds), eq(milestones.visibility, "client"), ne(milestones.status, "completed")))
              .orderBy(milestones.targetDate)
              .limit(5)
          : [];
        const now = new Date();
        const actions: { kind: string; title: string; href: string }[] = [];
        for (const p of props) if (!p.expiresAt || p.expiresAt > now) actions.push({ kind: "proposal", title: `Review proposal ${p.reference}: ${p.title}`, href: `/portal/proposals/${p.id}` });
        for (const i of invs) actions.push({ kind: isOverdue(i, now) ? "overdue_invoice" : "invoice", title: `${isOverdue(i, now) ? "Overdue" : "Pay"} invoice ${i.number}`, href: `/portal/invoices/${i.id}` });
        for (const { m, projectName } of upcoming) if (m.status === "awaiting_approval") actions.push({ kind: "approval", title: `Approve “${m.title}” on ${projectName}`, href: `/portal/projects/${m.projectId}` });
        const sorted = [...invs].sort((x, y) => (x.dueAt?.getTime() ?? 0) - (y.dueAt?.getTime() ?? 0));
        return {
          projects: projs.slice(0, 6).map((p) => ({ id: p.id, reference: p.reference, name: p.name, status: p.status, statusLabel: PROJECT_STATUS_LABELS[p.status], progressPct: p.progressPct, targetDate: p.targetDate })),
          actions,
          finance: {
            outstandingMinor: invs.reduce((s, i) => s + invoiceBalance(i), 0),
            overdueCount: invs.filter((i) => isOverdue(i, now)).length,
            nextPayment: sorted[0] ? { invoiceId: sorted[0].id, number: sorted[0].number, amountMinor: invoiceBalance(sorted[0]), dueAt: sorted[0].dueAt } : null,
          },
          upcomingMilestones: upcoming.map(({ m, projectName }) => ({ id: m.id, projectId: m.projectId, projectName, title: m.title, status: m.status, targetDate: m.targetDate })),
          recent: recent.map((n) => ({ id: n.id, subject: n.subject, link: n.link, createdAt: n.createdAt, read: Boolean(n.readAt) })),
          enquiriesCount: subs.length,
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/enquiries",
      summary: "My submitted briefs and their indicative estimates",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        const rows = await app.db
          .select({ s: configuratorSubmissions, e: estimates })
          .from(configuratorSubmissions)
          .leftJoin(estimates, and(eq(estimates.submissionId, configuratorSubmissions.id), ne(estimates.status, "superseded")))
          .where(inArray(configuratorSubmissions.organizationId, orgIds))
          .orderBy(desc(configuratorSubmissions.submittedAt));
        return rows.map((r) => ({
          id: r.s.id,
          reference: r.s.reference,
          status: r.s.status,
          submittedAt: r.s.submittedAt,
          solutionTypes: r.s.answers.solution.types,
          summary: r.s.answers.problem.description.slice(0, 240),
          estimate: r.e ? { lowMinor: r.e.lowMinor, highMinor: r.e.highMinor, confidence: r.e.confidence, requiresManualReview: r.e.requiresManualReview, priced: Boolean(r.e.result?.priced), isDemoPricing: r.e.isDemoPricing } : null,
          viewPath: `/estimate/${r.s.reference}?token=${estimateAccessToken(app.config.APP_SECRET, r.s.reference)}`,
        }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/enquiries/:id",
      summary: "A submitted brief with its estimate",
      tags: ["portal"],
      auth: "user",
      params: z.object({ id: z.uuid() }),
      handler: async ({ params, auth }) => {
        const a = requireVerifiedClient(auth);
        const [s] = await app.db.select().from(configuratorSubmissions).where(eq(configuratorSubmissions.id, params.id));
        if (!s) throw notFound("Enquiry");
        await assertOrgAccess(app.db, a.user.id, s.organizationId, "Enquiry");
        return { ...(await buildEstimateView(app, app.db, s)), answers: s.answers };
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/organization",
      summary: "My organisation and billing details",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const rows = await app.db
          .select({ org: organizations, role: organizationMembers.role })
          .from(organizationMembers)
          .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
          .where(eq(organizationMembers.userId, a.user.id));
        return rows.map((r) => ({ ...r.org, memberRole: r.role }));
      },
    }),
    defineRoute({
      method: "patch",
      path: "/portal/organization/:id",
      summary: "Update company/billing details",
      tags: ["portal"],
      auth: "user",
      params: z.object({ id: z.uuid() }),
      body: z.object({
        name: z.string().trim().min(1).max(160).optional(),
        registrationNumber: z.string().trim().max(60).nullable().optional(),
        vatNumber: z.string().trim().max(40).nullable().optional(),
        industry: z.string().trim().max(120).nullable().optional(),
        billingEmail: z.email().nullable().optional(),
        billingAddress: addressSchema.optional(),
      }),
      handler: async ({ params, body, auth, req }) => {
        const a = requireVerifiedClient(auth);
        await assertOrgAccess(app.db, a.user.id, params.id, "Organisation");
        const [org] = await app.db.update(organizations).set(body).where(eq(organizations.id, params.id)).returning();
        await audit(app.db, req, { action: "organization.updated", entityType: "organization", entityId: params.id, after: body });
        return org;
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/notifications",
      summary: "In-app notifications",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireUser(auth);
        const rows = await app.db
          .select()
          .from(notifications)
          .where(and(eq(notifications.userId, a.user.id), eq(notifications.channel, "in_app")))
          .orderBy(desc(notifications.createdAt))
          .limit(100);
        return rows.map((n) => ({ id: n.id, subject: n.subject, body: n.body, link: n.link, createdAt: n.createdAt, read: Boolean(n.readAt) }));
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/notifications/read",
      summary: "Mark notifications read (all when ids omitted)",
      tags: ["portal"],
      auth: "user",
      body: z.object({ ids: z.array(z.uuid()).max(200).optional() }),
      response: okSchema,
      handler: async ({ body, auth }) => {
        const a = requireUser(auth);
        await app.db
          .update(notifications)
          .set({ readAt: new Date() })
          .where(and(eq(notifications.userId, a.user.id), eq(notifications.channel, "in_app"), isNull(notifications.readAt), body.ids?.length ? inArray(notifications.id, body.ids) : undefined));
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/unread-count",
      summary: "Unread in-app notification count",
      tags: ["portal"],
      auth: "user",
      response: z.object({ count: z.number().int() }),
      handler: async ({ auth }) => {
        const a = requireUser(auth);
        const [r] = await app.db
          .select({ n: sql<number>`count(*)` })
          .from(notifications)
          .where(and(eq(notifications.userId, a.user.id), eq(notifications.channel, "in_app"), isNull(notifications.readAt)));
        return { count: Number(r.n) };
      },
    }),
  ];
}

void orders;
