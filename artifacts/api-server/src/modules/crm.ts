import { and, asc, desc, eq, ilike, isNull, lte, or, inArray, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { configuratorSubmissions, estimates, leadActivities, leads, proposals, tasks, users, pricingRuleVersions } from "@workspace/db";
import { estimateProject, hasPermission, leadMachine, pricingRulesSchema, TransitionError, LEAD_STATUS_LABELS, type LeadStatus } from "@workspace/domain";
import { contactBody, leadActivityBody, leadCreateBody, leadListQuery, leadUpdateBody, paginationQuery, submissionReviewBody, taskBody, taskUpdateBody, okSchema } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, forbidden, notFound } from "../lib/errors";
import { cursorOrder, cursorWhere, likePattern, nextNumber, pageOf } from "../lib/db-helpers";
import { limits } from "../middleware/rate-limit";
import { audit } from "../services/audit";
import { captureLead } from "../services/leads";
import type { AuthInfo } from "../middleware/session";
import { getActiveRules } from "./pricing";
import { buildEstimateView } from "./configurator";
import type { AppContext } from "../context";

const idParams = z.object({ id: z.uuid() });

/** Staff without leads.read_all only see leads assigned to them. */
export function leadScope(auth: AuthInfo): SQL | undefined {
  if (hasPermission(auth.user.role, "leads.read_all")) return undefined;
  return eq(leads.ownerId, auth.user.id);
}

async function loadLeadFor(app: AppContext, auth: AuthInfo, id: string) {
  const [lead] = await app.db.select().from(leads).where(and(eq(leads.id, id), leadScope(auth)));
  if (!lead) throw notFound("Lead");
  return lead;
}

export function contactRoutes(app: AppContext): RouteDef[] {
  const limit = limits.contact();
  return [
    defineRoute({
      method: "post",
      path: "/contact",
      summary: "Contact form → lead (deduplicated)",
      tags: ["public"],
      auth: "public",
      body: contactBody,
      middleware: [limit],
      successStatus: 201,
      response: z.object({ reference: z.string() }),
      handler: async ({ body, req }) => {
        const lead = await app.db.transaction(async (tx) => {
          const l = await captureLead(app, tx, req, {
            source: "contact_form",
            contactName: body.name,
            email: body.email,
            phone: body.phone,
            companyName: body.company,
            interest: body.topic.replace("_", " "),
            budgetBand: body.budgetBand,
            summary: body.message,
            consentMarketing: body.consentMarketing,
            attribution: body.attribution,
          });
          await tx.insert(leadActivities).values({ leadId: l.id, type: "enquiry", body: body.message, metadata: { topic: body.topic } });
          await app.notifications.queue(tx, { template: "contact.received", toEmail: body.email, channels: ["email"], data: { name: body.name } });
          return l;
        });
        void app.notifications.dispatchPending();
        return { reference: lead.reference };
      },
    }),
  ];
}

export function adminCrmRoutes(app: AppContext): RouteDef[] {
  const readPerm = ["leads.read_all", "leads.read_assigned"] as const;
  return [
    defineRoute({
      method: "get",
      path: "/admin/leads",
      summary: "Search and filter leads (cursor paginated)",
      tags: ["admin:crm"],
      auth: "staff",
      permission: [...readPerm],
      query: leadListQuery,
      handler: async ({ query, auth }) => {
        const a = requireUser(auth);
        const where = and(
          leadScope(a),
          query.status ? eq(leads.status, query.status) : undefined,
          query.source ? eq(leads.source, query.source) : undefined,
          query.ownerId === "me" ? eq(leads.ownerId, a.user.id) : query.ownerId === "unassigned" ? isNull(leads.ownerId) : query.ownerId ? eq(leads.ownerId, query.ownerId) : undefined,
          query.followUpDue ? lte(leads.nextFollowUpAt, new Date()) : undefined,
          query.q
            ? or(ilike(leads.contactName, likePattern(query.q)), ilike(leads.email, likePattern(query.q)), ilike(leads.companyName, likePattern(query.q)), ilike(leads.reference, likePattern(query.q)))
            : undefined,
          cursorWhere(leads.createdAt, leads.id, query.cursor),
        );
        const rows = await app.db
          .select({ lead: leads, ownerName: users.name })
          .from(leads)
          .leftJoin(users, eq(users.id, leads.ownerId))
          .where(where)
          .orderBy(...cursorOrder(leads.createdAt, leads.id))
          .limit(query.limit + 1);
        const page = pageOf(rows.map((r) => ({ ...r.lead, ownerName: r.ownerName })), query.limit);
        return page;
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/leads/:id",
      summary: "Lead with activity history, briefs, proposals and tasks",
      tags: ["admin:crm"],
      auth: "staff",
      permission: [...readPerm],
      params: idParams,
      handler: async ({ params, auth }) => {
        const lead = await loadLeadFor(app, requireUser(auth), params.id);
        const [activities, subs, props, leadTasks, duplicate] = await Promise.all([
          app.db
            .select({ a: leadActivities, actorName: users.name })
            .from(leadActivities)
            .leftJoin(users, eq(users.id, leadActivities.actorId))
            .where(eq(leadActivities.leadId, lead.id))
            .orderBy(desc(leadActivities.occurredAt)),
          app.db
            .select({ id: configuratorSubmissions.id, reference: configuratorSubmissions.reference, status: configuratorSubmissions.status, submittedAt: configuratorSubmissions.submittedAt })
            .from(configuratorSubmissions)
            .where(eq(configuratorSubmissions.leadId, lead.id))
            .orderBy(desc(configuratorSubmissions.submittedAt)),
          app.db
            .select({ id: proposals.id, reference: proposals.reference, version: proposals.version, status: proposals.status, title: proposals.title, totalMinor: proposals.totalMinor, groupId: proposals.groupId })
            .from(proposals)
            .where(eq(proposals.leadId, lead.id))
            .orderBy(desc(proposals.createdAt)),
          app.db.select().from(tasks).where(eq(tasks.leadId, lead.id)).orderBy(asc(tasks.dueAt)),
          lead.possibleDuplicateOfId
            ? app.db.select({ id: leads.id, reference: leads.reference, contactName: leads.contactName, companyName: leads.companyName }).from(leads).where(eq(leads.id, lead.possibleDuplicateOfId))
            : Promise.resolve([]),
        ]);
        return {
          lead,
          activities: activities.map((r) => ({ ...r.a, actorName: r.actorName })),
          submissions: subs,
          proposals: props,
          tasks: leadTasks,
          possibleDuplicate: duplicate[0] ?? null,
          statusOptions: leadMachine.next(lead.status).map((s) => ({ key: s, label: LEAD_STATUS_LABELS[s] })),
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/leads",
      summary: "Create a lead manually",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      body: leadCreateBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        return app.db.transaction(async (tx) => {
          const lead = await captureLead(app, tx, req, { source: "admin", contactName: body.contactName, email: body.email, phone: body.phone, companyName: body.companyName, jobTitle: body.jobTitle, interest: body.interest, budgetBand: body.budgetBand, timeline: body.timeline, summary: body.summary, silent: true });
          const ownerId = body.ownerId === undefined ? a.user.id : body.ownerId;
          if (ownerId && (ownerId === a.user.id || hasPermission(a.user.role, "leads.assign"))) {
            await tx.update(leads).set({ ownerId, tags: body.tags }).where(eq(leads.id, lead.id));
          }
          return { id: lead.id, reference: lead.reference, isNew: lead.isNew };
        });
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/leads/:id",
      summary: "Update a lead: details, status, owner, follow-up",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      params: idParams,
      body: leadUpdateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const lead = await loadLeadFor(app, a, params.id);
        return app.db.transaction(async (tx) => {
          const patch: Partial<typeof leads.$inferInsert> = {};
          const activity: { type: "status_change" | "assignment" | "note"; body: string; metadata?: Record<string, unknown> }[] = [];
          for (const k of ["contactName", "phone", "companyName", "jobTitle", "interest", "budgetBand", "timeline", "summary", "tags", "lostReason", "possibleDuplicateOfId"] as const) {
            if (body[k] !== undefined) (patch as Record<string, unknown>)[k] = body[k];
          }
          if (body.email !== undefined) {
            patch.email = body.email;
            patch.emailNormalized = body.email.toLowerCase();
          }
          if (body.nextFollowUpAt !== undefined) patch.nextFollowUpAt = body.nextFollowUpAt ? new Date(body.nextFollowUpAt) : null;
          if (body.status && body.status !== lead.status) {
            try {
              leadMachine.assert(lead.status, body.status);
            } catch (e) {
              if (e instanceof TransitionError) throw new AppError(422, "invalid_transition", `A lead can't move from ${LEAD_STATUS_LABELS[lead.status]} to ${LEAD_STATUS_LABELS[body.status as LeadStatus]}.`);
              throw e;
            }
            if (body.status === "lost" && !body.lostReason && !lead.lostReason) throw new AppError(422, "validation_failed", "Record a reason when marking a lead as lost.");
            patch.status = body.status;
            activity.push({ type: "status_change", body: `${LEAD_STATUS_LABELS[lead.status]} → ${LEAD_STATUS_LABELS[body.status]}`, metadata: { from: lead.status, to: body.status } });
          }
          if (body.ownerId !== undefined && body.ownerId !== lead.ownerId) {
            if (!hasPermission(a.user.role, "leads.assign") && body.ownerId !== a.user.id) throw forbidden("Only admins can assign leads to other people.");
            let ownerName = "nobody";
            if (body.ownerId) {
              const [o] = await tx.select({ name: users.name, role: users.role }).from(users).where(eq(users.id, body.ownerId));
              if (!o || o.role === "client") throw new AppError(422, "validation_failed", "Leads can only be assigned to staff.");
              ownerName = o.name;
            }
            patch.ownerId = body.ownerId;
            activity.push({ type: "assignment", body: `Assigned to ${ownerName}`, metadata: { ownerId: body.ownerId } });
          }
          const [updated] = await tx.update(leads).set(patch).where(eq(leads.id, lead.id)).returning();
          for (const act of activity) await tx.insert(leadActivities).values({ leadId: lead.id, actorId: a.user.id, type: act.type, body: act.body, metadata: act.metadata ?? {} });
          await audit(tx, req, { action: "lead.updated", entityType: "lead", entityId: lead.id, before: { status: lead.status, ownerId: lead.ownerId }, after: { status: updated.status, ownerId: updated.ownerId } });
          return updated;
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/leads/:id/activities",
      summary: "Log a note, call, meeting or email",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      params: idParams,
      body: leadActivityBody,
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const a = requireUser(auth);
        const lead = await loadLeadFor(app, a, params.id);
        const [act] = await app.db
          .insert(leadActivities)
          .values({ leadId: lead.id, actorId: a.user.id, type: body.type, body: body.body, occurredAt: body.occurredAt ? new Date(body.occurredAt) : new Date() })
          .returning();
        if (lead.status === "new" && ["call", "meeting", "email"].includes(body.type)) {
          await app.db.update(leads).set({ status: "contacted" }).where(eq(leads.id, lead.id));
        }
        return act;
      },
    }),
    // ------------------------------------------------------------ tasks / reminders
    defineRoute({
      method: "get",
      path: "/admin/tasks",
      summary: "Open tasks and follow-up reminders",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      query: z.object({ scope: z.enum(["mine", "all"]).default("mine"), includeDone: z.enum(["true", "false"]).default("false") }),
      handler: async ({ query, auth }) => {
        const a = requireUser(auth);
        const mine = query.scope === "mine" || !hasPermission(a.user.role, "leads.read_all");
        return app.db
          .select({ task: tasks, leadName: leads.contactName, leadReference: leads.reference })
          .from(tasks)
          .leftJoin(leads, eq(leads.id, tasks.leadId))
          .where(and(mine ? eq(tasks.assigneeId, a.user.id) : undefined, query.includeDone === "true" ? undefined : isNull(tasks.completedAt)))
          .orderBy(asc(tasks.dueAt))
          .limit(200);
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/tasks",
      summary: "Create a task / reminder",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      body: taskBody,
      successStatus: 201,
      handler: async ({ body, auth }) => {
        const a = requireUser(auth);
        if (body.leadId) await loadLeadFor(app, a, body.leadId);
        const [t] = await app.db
          .insert(tasks)
          .values({ ...body, dueAt: body.dueAt ? new Date(body.dueAt) : null, assigneeId: body.assigneeId ?? a.user.id, createdById: a.user.id })
          .returning();
        return t;
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/tasks/:id",
      summary: "Update or complete a task",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      params: idParams,
      body: taskUpdateBody,
      handler: async ({ params, body, auth }) => {
        const a = requireUser(auth);
        const [t] = await app.db.select().from(tasks).where(eq(tasks.id, params.id));
        if (!t || (!hasPermission(a.user.role, "leads.read_all") && t.assigneeId !== a.user.id && t.createdById !== a.user.id)) throw notFound("Task");
        const { completed, dueAt, ...rest } = body;
        const [u] = await app.db
          .update(tasks)
          .set({
            ...rest,
            ...(dueAt !== undefined ? { dueAt: dueAt ? new Date(dueAt) : null } : {}),
            ...(completed !== undefined ? { completedAt: completed ? new Date() : null } : {}),
          })
          .where(eq(tasks.id, params.id))
          .returning();
        return u;
      },
    }),
    // ------------------------------------------------------------ configurator submissions
    defineRoute({
      method: "get",
      path: "/admin/submissions",
      summary: "Configurator submissions with estimate summary and review flags",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "submissions.read",
      query: paginationQuery.extend({ status: z.enum(["submitted", "under_review", "estimate_ready", "converted", "closed"]).optional(), review: z.enum(["true"]).optional() }),
      handler: async ({ query, auth }) => {
        const a = requireUser(auth);
        const rows = await app.db
          .select({ s: configuratorSubmissions, lead: { id: leads.id, reference: leads.reference, contactName: leads.contactName, companyName: leads.companyName, ownerId: leads.ownerId }, est: estimates })
          .from(configuratorSubmissions)
          .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
          .leftJoin(estimates, eq(estimates.submissionId, configuratorSubmissions.id))
          .where(
            and(
              leadScope(a),
              query.status ? eq(configuratorSubmissions.status, query.status) : undefined,
              query.review ? eq(estimates.requiresManualReview, true) : undefined,
              query.q ? or(ilike(configuratorSubmissions.reference, likePattern(query.q)), ilike(leads.contactName, likePattern(query.q)), ilike(leads.companyName, likePattern(query.q))) : undefined,
              cursorWhere(configuratorSubmissions.createdAt, configuratorSubmissions.id, query.cursor),
            ),
          )
          .orderBy(...cursorOrder(configuratorSubmissions.createdAt, configuratorSubmissions.id))
          .limit(query.limit + 1);
        const page = pageOf(
          rows.map((r) => ({
            id: r.s.id,
            createdAt: r.s.createdAt,
            reference: r.s.reference,
            status: r.s.status,
            submittedAt: r.s.submittedAt,
            lead: r.lead,
            solutionTypes: r.s.answers.solution.types,
            estimate: r.est
              ? { reference: r.est.reference, lowMinor: r.est.lowMinor, highMinor: r.est.highMinor, confidence: r.est.confidence, requiresManualReview: r.est.requiresManualReview, recommendation: r.est.recommendation, status: r.est.status, flags: r.est.result?.flags.map((f) => f.code) ?? [] }
              : null,
          })),
          query.limit,
        );
        return page;
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/submissions/:id",
      summary: "Full brief, answers and estimate",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "submissions.read",
      params: idParams,
      handler: async ({ params, auth }) => {
        const a = requireUser(auth);
        const [row] = await app.db
          .select({ s: configuratorSubmissions, lead: leads })
          .from(configuratorSubmissions)
          .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
          .where(and(eq(configuratorSubmissions.id, params.id), leadScope(a)));
        if (!row) throw notFound("Submission");
        const allEstimates = await app.db.select().from(estimates).where(eq(estimates.submissionId, row.s.id)).orderBy(desc(estimates.createdAt));
        const relatedProposals = await app.db
          .select({ id: proposals.id, reference: proposals.reference, version: proposals.version, status: proposals.status })
          .from(proposals)
          .where(eq(proposals.submissionId, row.s.id));
        return { submission: row.s, lead: row.lead, view: await buildEstimateView(app, app.db, row.s), estimates: allEstimates, proposals: relatedProposals };
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/submissions/:id",
      summary: "Update review status/notes",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      params: idParams,
      body: submissionReviewBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const [row] = await app.db
          .select({ s: configuratorSubmissions })
          .from(configuratorSubmissions)
          .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
          .where(and(eq(configuratorSubmissions.id, params.id), leadScope(a)));
        if (!row) throw notFound("Submission");
        const [u] = await app.db
          .update(configuratorSubmissions)
          .set({ ...body, reviewedById: a.user.id })
          .where(eq(configuratorSubmissions.id, params.id))
          .returning();
        await audit(app.db, req, { action: "submission.reviewed", entityType: "configurator_submission", entityId: u.id, after: body });
        return u;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/submissions/:id/re-estimate",
      summary: "Recalculate with the current active rules (previous estimates are kept, marked superseded)",
      tags: ["admin:crm"],
      auth: "staff",
      permission: "leads.write",
      params: idParams,
      successStatus: 201,
      handler: async ({ params, auth, req }) => {
        const a = requireUser(auth);
        const [row] = await app.db
          .select({ s: configuratorSubmissions })
          .from(configuratorSubmissions)
          .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
          .where(and(eq(configuratorSubmissions.id, params.id), leadScope(a)));
        if (!row) throw notFound("Submission");
        const active = await getActiveRules(app.db);
        if (!active) throw new AppError(422, "unprocessable", "No active pricing rules. Activate a pricing version first.");
        let result;
        try {
          result = estimateProject(row.s.answers, active.rules, { tax: await app.settings.tax() });
        } catch (e) {
          throw new AppError(422, "unprocessable", (e as Error).message);
        }
        return app.db.transaction(async (tx) => {
          await tx.update(estimates).set({ status: "superseded" }).where(eq(estimates.submissionId, row.s.id));
          const reference = await nextNumber(tx, "EST");
          const [est] = await tx
            .insert(estimates)
            .values({
              reference,
              submissionId: row.s.id,
              pricingRuleVersionId: active.id,
              rulesVersion: active.version,
              isDemoPricing: active.isDemo,
              lowMinor: result.lowMinor,
              highMinor: result.highMinor,
              totalMinor: result.totalMinor,
              discoveryFeeMinor: result.discoveryFeeMinor,
              depositMinor: result.depositMinor,
              confidence: result.confidence,
              requiresManualReview: result.requiresManualReview,
              recommendation: result.recommendation,
              result,
            })
            .returning();
          await tx.update(configuratorSubmissions).set({ status: "estimate_ready" }).where(eq(configuratorSubmissions.id, row.s.id));
          await audit(tx, req, { action: "estimate.recalculated", entityType: "estimate", entityId: est.id, after: { reference, rulesVersion: active.version } });
          void a;
          return est;
        });
      },
    }),
  ];
}

// Silence unused import warnings for helpers used only in type positions.
void inArray;
void pricingRuleVersions;
void pricingRulesSchema;
void okSchema;
