import { and, desc, eq, gte, ilike, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  analyticsEvents,
  auditEvents,
  configuratorSubmissions,
  estimates,
  invoices,
  leads,
  notifications,
  orders,
  organizationMembers,
  organizations,
  paymentAttempts,
  projects,
  proposals,
  tasks,
  users,
  changeRequests,
  paymentTransactions,
} from "@workspace/db";
import { ANALYTICS_EVENTS, CLIENT_ANALYTICS_EVENTS, ROLES, canAssignRole, hasPermission, type AnalyticsEvent } from "@workspace/domain";
import { analyticsEventBody, HIGH_RISK_SETTINGS, SETTINGS_SCHEMAS, paginationQuery, publicSettingsSchema, userCreateBody, userUpdateBody, okSchema, type SettingsKey } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import { cursorOrder, cursorWhere, likePattern, normalizeEmail, pageOf } from "../lib/db-helpers";
import { limits } from "../middleware/rate-limit";
import { audit } from "../services/audit";
import { createAuthToken, findOrCreateClient, revokeAllSessions } from "../services/accounts";
import { LogTransport } from "../services/email";
import { invoiceBalance } from "../services/invoicing";
import { getActiveRules } from "./pricing";
import type { AppContext } from "../context";

const idParams = z.object({ id: z.uuid() });

export function adminSystemRoutes(app: AppContext): RouteDef[] {
  const analyticsLimit = limits.analytics();
  const routes: RouteDef[] = [
    // ------------------------------------------------------------ public settings & analytics
    defineRoute({
      method: "get",
      path: "/settings/public",
      summary: "Business details and commerce flags safe for the public site",
      tags: ["public"],
      auth: "public",
      response: publicSettingsSchema,
      handler: async () => {
        const [business, commerce, tax, cfg, active] = await Promise.all([app.settings.business(), app.settings.commerce(), app.settings.tax(), app.settings.get("configurator"), getActiveRules(app.db)]);
        return {
          business: { tradingName: business.tradingName, legalName: business.legalName, email: business.email, legalEmail: business.legalEmail, phone: business.phone, address: business.address, hours: business.hours, calLink: business.calLink, linkedinUrl: business.linkedinUrl },
          commerce: {
            currency: "ZAR" as const,
            termsVersion: commerce.termsVersion,
            refundPolicySummary: commerce.refundPolicySummary,
            paymentProviders: app.payments.available(commerce.enabledProviders).map((p) => p.key),
            taxLabel: tax.enabled ? tax.label : null,
            pricesShownIncludeTax: tax.enabled && tax.pricesIncludeTax,
          },
          configurator: { enabled: cfg.enabled, demoPricing: Boolean(active?.isDemo), pricingActive: Boolean(active) },
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/events",
      summary: "Record a client-side funnel event (the site only sends these after analytics consent)",
      tags: ["public"],
      auth: "public",
      body: analyticsEventBody,
      middleware: [analyticsLimit],
      successStatus: 202,
      response: okSchema,
      handler: async ({ body, auth }) => {
        if (!(CLIENT_ANALYTICS_EVENTS as readonly string[]).includes(body.name)) throw new AppError(400, "bad_request", "Unknown event.");
        await app.db.insert(analyticsEvents).values({ name: body.name as AnalyticsEvent, anonymousId: body.anonymousId, userId: auth?.user.id ?? null, entityType: body.entityType ?? null, entityId: body.entityId ?? null, properties: body.properties ?? {} });
        return { ok: true as const };
      },
    }),

    // ------------------------------------------------------------ dashboard & reports
    defineRoute({
      method: "get",
      path: "/admin/dashboard",
      summary: "Operations overview: leads, pipeline, proposals awaiting response, unpaid orders, active projects, overdue invoices",
      tags: ["admin:system"],
      auth: "staff",
      permission: "dashboard.read",
      handler: async ({ auth }) => {
        const a = requireUser(auth);
        const now = new Date();
        const since30 = new Date(now.getTime() - 30 * 86_400_000);
        const leadScope = hasPermission(a.user.role, "leads.read_all") ? undefined : eq(leads.ownerId, a.user.id);
        const [leadCounts, newLeads30, pipeline, awaiting, unpaidOrders, activeProjects, openInvoices, reviewQueue, myTasks, eftPending, openRequests, revenue30] = await Promise.all([
          app.db.select({ status: leads.status, n: sql<number>`count(*)` }).from(leads).where(leadScope).groupBy(leads.status),
          app.db.select({ n: sql<number>`count(*)` }).from(leads).where(and(leadScope, gte(leads.createdAt, since30))),
          app.db
            .select({ total: sql<number>`coalesce(sum(${estimates.highMinor}),0)`, n: sql<number>`count(*)` })
            .from(estimates)
            .innerJoin(configuratorSubmissions, eq(configuratorSubmissions.id, estimates.submissionId))
            .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
            .where(and(leadScope, inArray(leads.status, ["qualified", "discovery_proposed", "proposal_sent"]), sql`${estimates.status} <> 'superseded'`)),
          app.db.select({ id: proposals.id, reference: proposals.reference, title: proposals.title, totalMinor: proposals.totalMinor, sentAt: proposals.sentAt, expiresAt: proposals.expiresAt, status: proposals.status }).from(proposals).where(inArray(proposals.status, ["sent", "viewed"])).orderBy(proposals.sentAt).limit(10),
          app.db.select({ id: orders.id, reference: orders.reference, totalMinor: orders.totalMinor, createdAt: orders.createdAt }).from(orders).where(eq(orders.status, "pending_payment")).orderBy(desc(orders.createdAt)).limit(10),
          app.db.select({ status: projects.status, n: sql<number>`count(*)` }).from(projects).where(inArray(projects.status, ["awaiting_deposit", "not_started", "in_progress", "on_hold", "in_review"])).groupBy(projects.status),
          app.db.select().from(invoices).where(inArray(invoices.status, ["issued", "partially_paid"])),
          app.db
            .select({ n: sql<number>`count(*)` })
            .from(estimates)
            .innerJoin(configuratorSubmissions, eq(configuratorSubmissions.id, estimates.submissionId))
            .where(and(eq(estimates.requiresManualReview, true), sql`${estimates.status} <> 'superseded'`, inArray(configuratorSubmissions.status, ["submitted", "estimate_ready"]))),
          app.db.select().from(tasks).where(and(eq(tasks.assigneeId, a.user.id), isNull(tasks.completedAt), lte(tasks.dueAt, new Date(now.getTime() + 7 * 86_400_000)))).orderBy(tasks.dueAt).limit(10),
          app.db.select({ n: sql<number>`count(*)` }).from(paymentAttempts).where(eq(paymentAttempts.status, "pending_verification")),
          app.db.select({ n: sql<number>`count(*)` }).from(changeRequests).where(inArray(changeRequests.status, ["open", "triaged"])),
          app.db.select({ total: sql<number>`coalesce(sum(${paymentTransactions.amountMinor} - ${paymentTransactions.refundedMinor}),0)` }).from(paymentTransactions).where(gte(paymentTransactions.verifiedAt, since30)),
        ]);
        const overdue = openInvoices.filter((i) => i.dueAt && i.dueAt < now);
        const followUps = await app.db
          .select({ id: leads.id, reference: leads.reference, contactName: leads.contactName, nextFollowUpAt: leads.nextFollowUpAt })
          .from(leads)
          .where(and(leadScope, lte(leads.nextFollowUpAt, now)))
          .limit(10);
        return {
          leads: { byStatus: Object.fromEntries(leadCounts.map((r) => [r.status, Number(r.n)])), new30d: Number(newLeads30[0].n), followUpsDue: followUps },
          pipeline: { qualifiedValueHighMinor: Number(pipeline[0].total), count: Number(pipeline[0].n) },
          proposalsAwaiting: awaiting,
          unpaidOrders,
          projects: Object.fromEntries(activeProjects.map((r) => [r.status, Number(r.n)])),
          invoices: {
            outstandingMinor: openInvoices.reduce((s, i) => s + invoiceBalance(i), 0),
            overdueCount: overdue.length,
            overdueMinor: overdue.reduce((s, i) => s + invoiceBalance(i), 0),
          },
          reviewQueue: Number(reviewQueue[0].n),
          eftPending: Number(eftPending[0].n),
          openRequests: Number(openRequests[0].n),
          revenue30dMinor: Number(revenue30[0].total),
          myTasks,
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/reports/funnel",
      summary: "Funnel metrics from the event taxonomy (last N days)",
      tags: ["admin:system"],
      auth: "staff",
      permission: "dashboard.read",
      query: z.object({ days: z.coerce.number().int().min(1).max(365).default(30) }),
      handler: async ({ query }) => {
        const since = new Date(Date.now() - query.days * 86_400_000);
        const rows = await app.db.select({ name: analyticsEvents.name, n: sql<number>`count(*)` }).from(analyticsEvents).where(gte(analyticsEvents.createdAt, since)).groupBy(analyticsEvents.name);
        const counts = Object.fromEntries(ANALYTICS_EVENTS.map((e) => [e, 0]));
        rows.forEach((r) => (counts[r.name] = Number(r.n)));
        const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
        return {
          days: query.days,
          counts,
          conversion: {
            configuratorCompletionPct: rate(counts.configurator_submitted, counts.configurator_started),
            checkoutConversionPct: rate(counts.payment_succeeded, counts.checkout_started),
            discoveryConversionPct: rate(counts.discovery_purchased, counts.discovery_checkout_started),
            proposalAcceptancePct: rate(counts.proposal_accepted, counts.proposal_sent),
          },
        };
      },
    }),

    // ------------------------------------------------------------ users, staff & organisations
    defineRoute({
      method: "get",
      path: "/admin/staff",
      summary: "Staff members (for assignment pickers)",
      tags: ["admin:system"],
      auth: "staff",
      permission: "console.access",
      handler: async () =>
        app.db
          .select({ id: users.id, name: users.name, email: users.email, role: users.role })
          .from(users)
          .where(and(inArray(users.role, ["staff", "finance", "admin", "owner"]), eq(users.status, "active")))
          .orderBy(users.name),
    }),
    defineRoute({
      method: "get",
      path: "/admin/users",
      summary: "Users",
      tags: ["admin:system"],
      auth: "staff",
      permission: "users.read",
      query: paginationQuery.extend({ role: z.enum(ROLES).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ id: users.id, email: users.email, name: users.name, role: users.role, status: users.status, emailVerifiedAt: users.emailVerifiedAt, mfaEnabledAt: users.mfaEnabledAt, lastLoginAt: users.lastLoginAt, createdAt: users.createdAt })
          .from(users)
          .where(and(query.role ? eq(users.role, query.role) : undefined, query.q ? or(ilike(users.email, likePattern(query.q)), ilike(users.name, likePattern(query.q))) : undefined, cursorWhere(users.createdAt, users.id, query.cursor)))
          .orderBy(...cursorOrder(users.createdAt, users.id))
          .limit(query.limit + 1);
        return pageOf(rows, query.limit);
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/users",
      summary: "Create a user (staff or client) and send an invitation",
      tags: ["admin:system"],
      auth: "staff",
      permission: "users.manage",
      body: userCreateBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        if (!canAssignRole(a.user.role, body.role)) throw forbidden("You can't create users with that role.");
        const [exists] = await app.db.select({ id: users.id }).from(users).where(eq(users.emailNormalized, normalizeEmail(body.email)));
        if (exists) throw conflict("A user with this email already exists.");
        const user = await app.db.transaction(async (tx) => {
          const c = await findOrCreateClient(tx, { email: body.email, name: body.name, company: body.role === "client" ? body.organizationName : (await app.settings.get("business", tx)).tradingName });
          await tx.update(users).set({ role: body.role }).where(eq(users.id, c.userId));
          if (body.sendInvite) {
            const token = await createAuthToken(tx, c.userId, "invite");
            await app.notifications.queue(tx, { template: "auth.invite", userId: c.userId, channels: ["email"], data: { name: body.name, path: `/auth/reset?token=${token}&invite=1` } });
          }
          await audit(tx, req, { action: "user.created", entityType: "user", entityId: c.userId, after: { email: body.email, role: body.role } });
          return c;
        });
        app.notifications.kick();
        return { id: user.userId };
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/users/:id",
      summary: "Change a user's name, role or status (role changes are audited; disabling revokes sessions)",
      tags: ["admin:system"],
      auth: "staff",
      permission: "users.manage",
      params: idParams,
      body: userUpdateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const [u] = await app.db.select().from(users).where(eq(users.id, params.id));
        if (!u) throw notFound("User");
        if (u.id === a.user.id && (body.role || body.status === "disabled")) throw forbidden("You can't change your own role or disable yourself.");
        if (!canAssignRole(a.user.role, u.role)) throw forbidden("You can't manage users with this role.");
        if (body.role && !canAssignRole(a.user.role, body.role)) throw forbidden("You can't grant that role.");
        if (body.role && !hasPermission(a.user.role, "roles.manage") && ["admin", "owner"].includes(body.role)) throw forbidden();
        if (u.role === "owner" && body.role && body.role !== "owner") {
          const [{ n }] = await app.db.select({ n: sql<number>`count(*)` }).from(users).where(and(eq(users.role, "owner"), eq(users.status, "active")));
          if (Number(n) <= 1) throw conflict("There must always be at least one owner.");
        }
        return app.db.transaction(async (tx) => {
          const [updated] = await tx.update(users).set(body).where(eq(users.id, u.id)).returning({ id: users.id, name: users.name, role: users.role, status: users.status });
          if (body.status === "disabled" || (body.role && body.role !== u.role)) await revokeAllSessions(tx, u.id);
          await audit(tx, req, { action: body.role && body.role !== u.role ? "user.role_changed" : "user.updated", entityType: "user", entityId: u.id, before: { role: u.role, status: u.status }, after: { role: updated.role, status: updated.status } });
          return updated;
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/organizations",
      summary: "Client organisations (for invoices/projects)",
      tags: ["admin:system"],
      auth: "staff",
      permission: ["orders.read", "projects.manage", "invoices.manage"],
      query: z.object({ q: z.string().max(100).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ o: organizations, members: sql<number>`(select count(*) from ${organizationMembers} where ${organizationMembers.organizationId} = ${organizations.id})` })
          .from(organizations)
          .where(query.q ? ilike(organizations.name, likePattern(query.q)) : undefined)
          .orderBy(organizations.name)
          .limit(100);
        return rows.map((r) => ({ ...r.o, members: Number(r.members) }));
      },
    }),

    // ------------------------------------------------------------ settings
    defineRoute({
      method: "get",
      path: "/admin/settings",
      summary: "All settings groups",
      tags: ["admin:system"],
      auth: "staff",
      permission: "settings.manage",
      handler: async () => {
        const keys = Object.keys(SETTINGS_SCHEMAS) as SettingsKey[];
        const values = await Promise.all(keys.map((k) => app.settings.get(k)));
        const providers = ["payfast", "yoco", "eft"].map((k) => ({ key: k, configured: Boolean(app.payments.get(k as never)?.configured()), label: app.payments.get(k as never)?.label }));
        return { ...Object.fromEntries(keys.map((k, i) => [k, values[i]])), _providers: providers, _highRisk: HIGH_RISK_SETTINGS, _email: app.notifications.transportName, _storage: app.storage.name };
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/settings/:key",
      summary: "Replace a settings group (tax and security require the owner)",
      tags: ["admin:system"],
      auth: "staff",
      permission: "settings.manage",
      params: z.object({ key: z.enum(Object.keys(SETTINGS_SCHEMAS) as [SettingsKey, ...SettingsKey[]]) }),
      body: z.object({ value: z.unknown() }),
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        if (HIGH_RISK_SETTINGS.includes(params.key) && !hasPermission(a.user.role, "settings.high_risk")) throw forbidden("Only the owner can change tax and security settings.");
        const parsed = SETTINGS_SCHEMAS[params.key].safeParse(body.value);
        if (!parsed.success) throw new AppError(400, "validation_failed", "Invalid settings.", parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })));
        const before = await app.settings.get(params.key);
        await app.db.transaction(async (tx) => {
          await app.settings.set(params.key, parsed.data as never, a.user.id, tx);
          await audit(tx, req, { action: `settings.${params.key}_updated`, entityType: "settings", entityId: params.key, before, after: parsed.data });
        });
        app.settings.invalidate();
        return app.settings.get(params.key);
      },
    }),

    // ------------------------------------------------------------ audit & notifications
    defineRoute({
      method: "get",
      path: "/admin/audit",
      summary: "Immutable audit log",
      tags: ["admin:system"],
      auth: "staff",
      permission: "audit.read",
      query: paginationQuery.extend({ entityType: z.string().max(40).optional(), entityId: z.string().max(80).optional(), action: z.string().max(80).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ e: auditEvents, actorName: users.name, actorEmail: users.email })
          .from(auditEvents)
          .leftJoin(users, eq(users.id, auditEvents.actorId))
          .where(
            and(
              query.entityType ? eq(auditEvents.entityType, query.entityType) : undefined,
              query.entityId ? eq(auditEvents.entityId, query.entityId) : undefined,
              query.action ? ilike(auditEvents.action, likePattern(query.action)) : undefined,
              cursorWhere(auditEvents.createdAt, auditEvents.id, query.cursor),
            ),
          )
          .orderBy(...cursorOrder(auditEvents.createdAt, auditEvents.id))
          .limit(query.limit + 1);
        return pageOf(rows.map((r) => ({ ...r.e, actorName: r.actorName, actorEmail: r.actorEmail })), query.limit);
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/notifications",
      summary: "Email outbox / delivery log",
      tags: ["admin:system"],
      auth: "staff",
      permission: "settings.manage",
      query: paginationQuery.extend({ status: z.enum(["queued", "sent", "failed", "skipped"]).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ id: notifications.id, createdAt: notifications.createdAt, toEmail: notifications.toEmail, template: notifications.template, subject: notifications.subject, status: notifications.status, error: notifications.error, sentAt: notifications.sentAt, attempts: notifications.attempts })
          .from(notifications)
          .where(and(eq(notifications.channel, "email"), query.status ? eq(notifications.status, query.status) : undefined, cursorWhere(notifications.createdAt, notifications.id, query.cursor)))
          .orderBy(...cursorOrder(notifications.createdAt, notifications.id))
          .limit(query.limit + 1);
        return pageOf(rows, query.limit);
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/notifications/dispatch",
      summary: "Send queued/failed emails now",
      tags: ["admin:system"],
      auth: "staff",
      permission: "settings.manage",
      handler: async () => ({ sent: await app.notifications.dispatchPending(100) }),
    }),
  ];

  // Local development/E2E only: read the in-memory outbox of the log email driver.
  if (!app.config.isProd && app.email instanceof LogTransport) {
    const outbox = app.email.outbox;
    routes.push(
      defineRoute({
        method: "get",
        path: "/dev/outbox",
        summary: "DEV ONLY — emails captured by the log driver (never mounted in production)",
        tags: ["dev"],
        auth: "public",
        query: z.object({ to: z.string().max(254).optional() }),
        handler: async ({ query }) => {
          await app.notifications.dispatchPending(100);
          return outbox.filter((m) => !query.to || m.to.toLowerCase() === query.to.toLowerCase()).slice(-50).reverse();
        },
      }),
    );
  }
  return routes;
}

void lt;
