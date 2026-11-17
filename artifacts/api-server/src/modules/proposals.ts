import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  configuratorSubmissions,
  estimates,
  leadActivities,
  leads,
  messages,
  milestones,
  orderItems,
  orders,
  organizations,
  projects,
  proposals,
  users,
  type DbOrTx,
  type ProposalMilestone,
} from "@workspace/db";
import { allocateByBps, computeTax, proposalMachine, sumMinor, type TaxConfig } from "@workspace/domain";
import { messageBody, proposalBody, proposalClarifyBody, proposalDecisionBody, proposalFromSubmissionBody, proposalUpdateBody, type ProposalBody } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, conflict, notFound } from "../lib/errors";
import { addDays, nextNumber } from "../lib/db-helpers";
import { sha256 } from "../lib/crypto";
import { audit, track } from "../services/audit";
import { assertOrgAccess, createAuthToken, findOrCreateClient, userOrganizationIds } from "../services/accounts";
import { issueInvoice } from "../services/invoicing";
import { renderProposalPdf } from "../services/pdf";
import { leadScope } from "./crm";
import { requireVerifiedClient } from "./portal";
import type { AppContext } from "../context";

type ProposalRow = typeof proposals.$inferSelect;

/** Derive all money fields from line items + schedule. The client never supplies totals. */
export function computeProposalCommercials(body: Pick<ProposalBody, "lineItems" | "milestones" | "depositMilestoneKey">, tax: TaxConfig) {
  const percentSum = body.milestones.reduce((a, m) => a + m.percentBps, 0);
  if (percentSum !== 10_000) throw new AppError(422, "validation_failed", `Milestone percentages must add up to 100% (currently ${percentSum / 100}%).`);
  const keys = new Set(body.milestones.map((m) => m.key));
  if (keys.size !== body.milestones.length) throw new AppError(422, "validation_failed", "Milestone keys must be unique.");
  const lineItems = body.lineItems.map((l) => ({ ...l, totalMinor: l.unitMinor * l.quantity }));
  const net = sumMinor(lineItems.map((l) => l.totalMinor));
  const taxed = computeTax(net, { ...tax, pricesIncludeTax: false });
  const amounts = allocateByBps(taxed.totalMinor, body.milestones.map((m) => m.percentBps));
  const depositKey = body.depositMilestoneKey ?? body.milestones[0].key;
  const ms: ProposalMilestone[] = body.milestones.map((m, i) => ({ ...m, amountMinor: amounts[i], isDeposit: m.key === depositKey }));
  const deposit = ms.find((m) => m.key === depositKey);
  if (!deposit) throw new AppError(422, "validation_failed", "Deposit milestone not found in the schedule.");
  return { lineItems, milestones: ms, subtotalMinor: taxed.subtotalMinor, taxMinor: taxed.taxMinor, totalMinor: taxed.totalMinor, depositMinor: deposit.amountMinor };
}

/** Canonical fingerprint of the commercial content a client accepts. */
export function proposalContentHash(p: Pick<ProposalRow, "reference" | "version" | "title" | "summary" | "sections" | "lineItems" | "assumptions" | "exclusions" | "milestones" | "subtotalMinor" | "taxMinor" | "totalMinor" | "depositMinor" | "terms" | "expiresAt" | "timelineSummary">): string {
  return sha256(
    JSON.stringify({
      reference: p.reference,
      version: p.version,
      title: p.title,
      summary: p.summary,
      sections: p.sections,
      lineItems: p.lineItems,
      assumptions: p.assumptions,
      exclusions: p.exclusions,
      milestones: p.milestones,
      subtotalMinor: p.subtotalMinor,
      taxMinor: p.taxMinor,
      totalMinor: p.totalMinor,
      depositMinor: p.depositMinor,
      terms: p.terms,
      timelineSummary: p.timelineSummary,
      expiresAt: p.expiresAt?.toISOString() ?? null,
    }),
  );
}

function isExpired(p: ProposalRow, now = new Date()) {
  return p.expiresAt !== null && p.expiresAt < now;
}

/** Client-facing projection. Never exposes internal ids beyond what the portal needs. */
export function toClientProposal(p: ProposalRow, latestVersion: number) {
  return {
    id: p.id,
    groupId: p.groupId,
    reference: p.reference,
    version: p.version,
    isLatest: p.version === latestVersion,
    status: p.status === "sent" || p.status === "viewed" ? (isExpired(p) ? "expired" : p.status) : p.status,
    title: p.title,
    summary: p.summary,
    sections: p.sections,
    lineItems: p.lineItems,
    assumptions: p.assumptions,
    exclusions: p.exclusions,
    milestones: p.milestones,
    timelineSummary: p.timelineSummary,
    terms: p.terms,
    currency: p.currency,
    subtotalMinor: p.subtotalMinor,
    taxMinor: p.taxMinor,
    taxLabel: p.taxSnapshot?.enabled ? p.taxSnapshot.label : null,
    totalMinor: p.totalMinor,
    depositMinor: p.depositMinor,
    expiresAt: p.expiresAt,
    sentAt: p.sentAt,
    viewedAt: p.viewedAt,
    acceptedAt: p.acceptedAt,
    declinedAt: p.declinedAt,
    declineReason: p.declineReason,
    contentHash: p.contentHash,
  };
}

async function latestVersionOf(tx: DbOrTx, groupId: string): Promise<number> {
  const [r] = await tx.select({ v: sql<number>`max(${proposals.version})` }).from(proposals).where(eq(proposals.groupId, groupId));
  return Number(r?.v ?? 1);
}

/**
 * Accept a proposal version. One transaction: lock the proposal, verify it is the
 * current sent version with the exact content hash, then create the order, project,
 * milestones and deposit invoice, and close the lead as won.
 */
export async function acceptProposal(app: AppContext, req: Parameters<typeof audit>[1], userId: string, proposalId: string, contentHash: string) {
  return app.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`select id from proposals where id = ${proposalId} for update`);
    if (!locked.rows.length) throw notFound("Proposal");
    const [p] = await tx.select().from(proposals).where(eq(proposals.id, proposalId));
    if (p.status === "accepted") throw conflict("This proposal has already been accepted.");
    if (!["sent", "viewed"].includes(p.status)) throw new AppError(422, "invalid_transition", "This proposal can no longer be accepted.");
    if (isExpired(p)) throw new AppError(422, "invalid_transition", "This proposal has expired. Ask us for an updated version.");
    if ((await latestVersionOf(tx, p.groupId)) !== p.version) throw conflict("A newer version of this proposal exists. Please review the latest version.", "version_conflict");
    if (p.contentHash !== contentHash || proposalContentHash(p) !== contentHash) throw conflict("The proposal changed while you were reviewing it. Reload to see the current version.", "version_conflict");
    if (!p.organizationId) throw new AppError(500, "internal_error", "Proposal has no client organisation.");

    const now = new Date();
    await tx
      .update(proposals)
      .set({ status: "accepted", acceptedAt: now, acceptedById: userId, acceptedIp: (req as { ip?: string } | null)?.ip ?? null, rowVersion: p.rowVersion + 1 })
      .where(eq(proposals.id, p.id));
    await tx.update(proposals).set({ status: "superseded" }).where(and(eq(proposals.groupId, p.groupId), ne(proposals.id, p.id), inArray(proposals.status, ["draft", "sent", "viewed"])));

    const [org] = await tx.select().from(organizations).where(eq(organizations.id, p.organizationId));
    const [user] = await tx.select().from(users).where(eq(users.id, userId));
    const orderRef = await nextNumber(tx, "ORD");
    const [order] = await tx
      .insert(orders)
      .values({
        reference: orderRef,
        organizationId: p.organizationId,
        userId,
        leadId: p.leadId,
        source: "proposal",
        proposalId: p.id,
        submissionId: p.submissionId,
        status: "confirmed",
        subtotalMinor: p.subtotalMinor,
        taxMinor: p.taxMinor,
        totalMinor: p.totalMinor,
        depositMinor: p.depositMinor,
        billingDetails: { name: org?.name ?? user.name, email: org?.billingEmail ?? user.email, company: org?.kind === "company" ? org.name : undefined, vatNumber: org?.vatNumber ?? undefined },
        termsAcceptedAt: now,
        termsVersion: `proposal:${p.reference}:v${p.version}`,
        snapshot: { proposal: toClientProposal({ ...p, status: "accepted", acceptedAt: now }, p.version) },
        idempotencyKey: `proposal-accept:${p.id}`,
        confirmedAt: now,
      })
      .returning();
    await tx.insert(orderItems).values(p.lineItems.map((l) => ({ orderId: order.id, kind: "line" as const, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, totalMinor: l.totalMinor })));

    const projectRef = await nextNumber(tx, "PRJ");
    const depositRequired = p.depositMinor > 0;
    const [project] = await tx
      .insert(projects)
      .values({
        reference: projectRef,
        organizationId: p.organizationId,
        orderId: order.id,
        proposalId: p.id,
        name: p.title,
        summary: p.summary.slice(0, 5000),
        status: depositRequired ? "awaiting_deposit" : "not_started",
        contractValueMinor: p.totalMinor,
        depositRequired,
        targetDate: p.milestones.length ? addDays(now, Math.max(...p.milestones.map((m) => m.targetOffsetDays))) : null,
      })
      .returning();
    const depositKey = p.milestones.find((m) => m.isDeposit)?.key ?? p.milestones[0]?.key;
    const createdMilestones = await tx
      .insert(milestones)
      .values(
        p.milestones.map((m, i) => ({
          projectId: project.id,
          key: m.key,
          title: m.title,
          description: m.description,
          displayOrder: i,
          amountMinor: m.amountMinor,
          billable: m.amountMinor > 0,
          targetDate: m.targetOffsetDays ? addDays(now, m.targetOffsetDays) : null,
        })),
      )
      .returning();

    let depositInvoice: Awaited<ReturnType<typeof issueInvoice>> | null = null;
    if (depositRequired) {
      const depositMilestone = createdMilestones.find((m) => m.key === depositKey)!;
      depositInvoice = await issueInvoice(app, tx, {
        organizationId: p.organizationId,
        orderId: order.id,
        projectId: project.id,
        milestoneId: depositMilestone.id,
        kind: "deposit",
        amounts: { mode: "gross", description: `Deposit — ${p.title} (${p.reference} v${p.version})`, grossMinor: p.depositMinor },
        tax: p.taxSnapshot ?? undefined,
      });
      await tx.update(milestones).set({ invoiceId: depositInvoice.id }).where(eq(milestones.id, depositMilestone.id));
      await tx.update(projects).set({ depositInvoiceId: depositInvoice.id }).where(eq(projects.id, project.id));
    }

    if (p.leadId) {
      await tx.update(leads).set({ status: "won", organizationId: p.organizationId }).where(eq(leads.id, p.leadId));
      await tx.insert(leadActivities).values({ leadId: p.leadId, actorId: userId, type: "proposal_event", body: `Proposal ${p.reference} v${p.version} accepted — order ${orderRef}, project ${projectRef}`, metadata: { proposalId: p.id, orderId: order.id, projectId: project.id } });
    }
    if (p.submissionId) await tx.update(configuratorSubmissions).set({ status: "converted" }).where(eq(configuratorSubmissions.id, p.submissionId));

    await audit(tx, req as never, {
      action: "proposal.accepted",
      entityType: "proposal",
      entityId: p.id,
      after: { reference: p.reference, version: p.version, contentHash, totalMinor: p.totalMinor, orderId: order.id, projectId: project.id },
    });
    await track(tx, "proposal_accepted", { userId, entityType: "proposal", entityId: p.id, properties: { totalMinor: p.totalMinor } });

    if (depositInvoice) {
      await app.notifications.queue(tx, {
        template: "invoice.issued",
        userId,
        category: "invoices",
        data: { number: depositInvoice.number, amountMinor: depositInvoice.totalMinor, description: "Deposit", dueDate: depositInvoice.dueAt?.toISOString().slice(0, 10), path: `/portal/invoices/${depositInvoice.id}` },
        dedupeKey: `invoice-issued:${depositInvoice.id}`,
      });
    }
    await app.notifications.queueStaff(tx, {
      template: "proposal.decision",
      data: { reference: p.reference, version: p.version, decision: "accepted", client: org?.name ?? user.name, path: `/admin/proposals/${p.id}` },
      dedupeKey: `proposal-accepted-staff:${p.id}`,
    });
    return { orderId: order.id, orderReference: orderRef, projectId: project.id, depositInvoiceId: depositInvoice?.id ?? null };
  });
}

const idParams = z.object({ id: z.uuid() });

export function adminProposalRoutes(app: AppContext): RouteDef[] {
  const perm = "proposals.manage" as const;

  async function loadForStaff(id: string, auth: Parameters<typeof leadScope>[0]) {
    const [p] = await app.db.select().from(proposals).where(eq(proposals.id, id));
    if (!p) throw notFound("Proposal");
    if (p.leadId) {
      const [l] = await app.db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, p.leadId), leadScope(auth)));
      if (!l) throw notFound("Proposal");
    }
    return p;
  }

  async function insertVersion(tx: DbOrTx, base: { groupId: string; reference: string; version: number }, body: ProposalBody, ctx: { leadId: string | null; organizationId: string | null; createdById: string }) {
    const tax = await app.settings.tax(tx);
    const c = computeProposalCommercials(body, tax);
    const [row] = await tx
      .insert(proposals)
      .values({
        groupId: base.groupId,
        reference: base.reference,
        version: base.version,
        leadId: ctx.leadId,
        organizationId: ctx.organizationId,
        submissionId: body.submissionId ?? null,
        estimateId: body.estimateId ?? null,
        status: "draft",
        title: body.title,
        summary: body.summary,
        sections: body.sections,
        lineItems: c.lineItems,
        assumptions: body.assumptions,
        exclusions: body.exclusions,
        milestones: c.milestones,
        timelineSummary: body.timelineSummary,
        terms: body.terms,
        subtotalMinor: c.subtotalMinor,
        taxMinor: c.taxMinor,
        totalMinor: c.totalMinor,
        depositMinor: c.depositMinor,
        taxSnapshot: { enabled: tax.enabled, rateBps: tax.rateBps, label: tax.label, pricesIncludeTax: tax.pricesIncludeTax },
        expiresAt: addDays(new Date(), body.expiresInDays),
        createdById: ctx.createdById,
      })
      .returning();
    return row;
  }

  const bodyFromRow = (p: ProposalRow): ProposalBody => ({
    leadId: p.leadId,
    organizationId: p.organizationId,
    submissionId: p.submissionId,
    estimateId: p.estimateId,
    title: p.title,
    summary: p.summary,
    sections: p.sections,
    lineItems: p.lineItems.map(({ description, quantity, unitMinor }) => ({ description, quantity, unitMinor })),
    assumptions: p.assumptions,
    exclusions: p.exclusions,
    milestones: p.milestones.map(({ key, title, description, percentBps, targetOffsetDays }) => ({ key, title, description, percentBps, targetOffsetDays })),
    depositMilestoneKey: p.milestones.find((m) => m.isDeposit)?.key,
    timelineSummary: p.timelineSummary,
    terms: p.terms,
    expiresInDays: p.expiresAt ? Math.max(1, Math.round((p.expiresAt.getTime() - p.createdAt.getTime()) / 86_400_000)) : 30,
  });

  return [
    defineRoute({
      method: "get",
      path: "/admin/proposals",
      summary: "Proposals (latest version per proposal)",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      query: z.object({ status: z.string().max(20).optional() }),
      handler: async ({ query, auth }) => {
        const a = requireUser(auth);
        const rows = await app.db
          .select({ p: proposals, leadName: leads.contactName, company: leads.companyName, orgName: organizations.name })
          .from(proposals)
          .leftJoin(leads, eq(leads.id, proposals.leadId))
          .leftJoin(organizations, eq(organizations.id, proposals.organizationId))
          .where(and(sql`${proposals.version} = (select max(p2.version) from proposals p2 where p2.group_id = ${proposals.groupId})`, query.status ? eq(proposals.status, query.status as never) : undefined, proposals.leadId ? undefined : undefined))
          .orderBy(desc(proposals.updatedAt))
          .limit(200);
        const scope = leadScope(a);
        const visibleLeadIds = scope ? new Set((await app.db.select({ id: leads.id }).from(leads).where(scope)).map((r) => r.id)) : null;
        return rows
          .filter((r) => !visibleLeadIds || !r.p.leadId || visibleLeadIds.has(r.p.leadId))
          .map((r) => ({ ...toClientProposal(r.p, r.p.version), leadId: r.p.leadId, clientName: r.orgName ?? r.company ?? r.leadName, expired: r.p.expiresAt ? r.p.expiresAt < new Date() : false, updatedAt: r.p.updatedAt }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/proposals/:id",
      summary: "Proposal with all versions and the clarification thread",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      handler: async ({ params, auth }) => {
        const p = await loadForStaff(params.id, requireUser(auth));
        const versions = await app.db
          .select({ id: proposals.id, version: proposals.version, status: proposals.status, totalMinor: proposals.totalMinor, createdAt: proposals.createdAt, sentAt: proposals.sentAt, acceptedAt: proposals.acceptedAt })
          .from(proposals)
          .where(eq(proposals.groupId, p.groupId))
          .orderBy(desc(proposals.version));
        const thread = await app.db
          .select({ m: messages, authorName: users.name, authorRole: users.role })
          .from(messages)
          .leftJoin(users, eq(users.id, messages.authorId))
          .where(and(eq(messages.threadType, "proposal"), eq(messages.threadId, p.groupId)))
          .orderBy(messages.createdAt);
        const [lead] = p.leadId ? await app.db.select().from(leads).where(eq(leads.id, p.leadId)) : [null];
        const [order] = await app.db.select({ id: orders.id, reference: orders.reference }).from(orders).where(eq(orders.proposalId, p.id));
        return {
          proposal: { ...toClientProposal(p, versions[0]?.version ?? p.version), leadId: p.leadId, organizationId: p.organizationId, submissionId: p.submissionId, rowVersion: p.rowVersion, editable: p.status === "draft" },
          input: bodyFromRow(p),
          versions,
          thread: thread.map((r) => ({ ...r.m, authorName: r.authorName, authorRole: r.authorRole })),
          lead,
          order: order ?? null,
        };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/proposals",
      summary: "Create a draft proposal (v1)",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      body: proposalBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        if (!body.leadId && !body.organizationId) throw new AppError(422, "validation_failed", "Link the proposal to a lead or a client organisation.");
        return app.db.transaction(async (tx) => {
          let organizationId = body.organizationId ?? null;
          if (body.leadId) {
            const [l] = await tx.select().from(leads).where(and(eq(leads.id, body.leadId), leadScope(a)));
            if (!l) throw notFound("Lead");
            organizationId = organizationId ?? l.organizationId;
          }
          const reference = await nextNumber(tx, "PRO", new Date(), 4);
          const row = await insertVersion(tx, { groupId: crypto.randomUUID(), reference, version: 1 }, body, { leadId: body.leadId ?? null, organizationId, createdById: a.user.id });
          await audit(tx, req, { action: "proposal.created", entityType: "proposal", entityId: row.id, after: { reference, totalMinor: row.totalMinor } });
          await track(tx, "proposal_created", { userId: a.user.id, entityType: "proposal", entityId: row.id });
          return { id: row.id, reference };
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/proposals/from-submission",
      summary: "Create a draft proposal pre-filled from a configurator brief and its estimate",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      body: proposalFromSubmissionBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        const [row] = await app.db
          .select({ s: configuratorSubmissions, lead: leads })
          .from(configuratorSubmissions)
          .innerJoin(leads, eq(leads.id, configuratorSubmissions.leadId))
          .where(and(eq(configuratorSubmissions.id, body.submissionId), leadScope(a)));
        if (!row) throw notFound("Submission");
        const [est] = await app.db.select().from(estimates).where(and(eq(estimates.submissionId, row.s.id), ne(estimates.status, "superseded"))).orderBy(desc(estimates.createdAt)).limit(1);
        const r = est?.result;
        const answers = row.s.answers;
        const commerce = await app.settings.commerce();
        const draft: ProposalBody = {
          leadId: row.lead.id,
          organizationId: row.s.organizationId,
          submissionId: row.s.id,
          estimateId: est?.id ?? null,
          title: `${r?.recommendedSolution ?? "Custom software"} for ${answers.context.company || answers.context.name}`,
          summary: answers.problem.description,
          sections: [
            { heading: "The problem", body: answers.problem.description },
            { heading: "What success looks like", body: answers.problem.successLooksLike || "To be confirmed during discovery." },
            { heading: "Proposed solution", body: r ? `${r.recommendedSolution}.` : "To be defined." },
          ],
          lineItems: r?.priced
            ? r.lineItems.map((li) => ({ description: li.label, quantity: 1, unitMinor: li.amountMinor }))
            : [{ description: "Scope to be confirmed", quantity: 1, unitMinor: 0 }],
          assumptions: r?.assumptions ?? [],
          exclusions: r?.exclusions ?? [],
          milestones: (r?.milestones ?? [{ key: "deposit", label: "Deposit on acceptance", description: "", percentBps: commerce.defaultDepositBps, amountMinor: 0 }, { key: "completion", label: "Completion", description: "", percentBps: 10_000 - commerce.defaultDepositBps, amountMinor: 0 }]).map((m, i, arr) => ({
            key: m.key,
            title: m.label,
            description: m.description,
            percentBps: m.percentBps,
            targetOffsetDays: r ? Math.round(((r.timeline.maxWeeks * 7) / Math.max(1, arr.length - 1)) * i) : 0,
          })),
          timelineSummary: r ? `Indicative delivery window: ${r.timeline.minWeeks}–${r.timeline.maxWeeks} weeks from kick-off, confirmed after discovery.` : "",
          terms: commerce.termsSummary,
          expiresInDays: commerce.proposalExpiryDays,
        };
        return app.db.transaction(async (tx) => {
          const reference = await nextNumber(tx, "PRO", new Date(), 4);
          const p = await insertVersion(tx, { groupId: crypto.randomUUID(), reference, version: 1 }, draft, { leadId: row.lead.id, organizationId: row.s.organizationId, createdById: a.user.id });
          await tx.update(configuratorSubmissions).set({ status: "under_review" }).where(eq(configuratorSubmissions.id, row.s.id));
          await audit(tx, req, { action: "proposal.created_from_submission", entityType: "proposal", entityId: p.id, after: { reference, submission: row.s.reference } });
          return { id: p.id, reference };
        });
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/proposals/:id",
      summary: "Edit a proposal. Drafts are edited in place; sent versions produce a new version.",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: proposalUpdateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const p = await loadForStaff(params.id, a);
        const { rowVersion, ...changes } = body;
        if (p.rowVersion !== rowVersion) throw conflict("Someone else changed this proposal. Reload and try again.", "version_conflict");
        if (p.status === "accepted" || p.status === "superseded") throw conflict("Accepted or superseded proposals cannot be edited.");
        const merged: ProposalBody = { ...bodyFromRow(p), ...changes } as ProposalBody;
        return app.db.transaction(async (tx) => {
          if (p.status === "draft") {
            const tax = await app.settings.tax(tx);
            const c = computeProposalCommercials(merged, tax);
            const rows = await tx
              .update(proposals)
              .set({
                title: merged.title,
                summary: merged.summary,
                sections: merged.sections,
                lineItems: c.lineItems,
                assumptions: merged.assumptions,
                exclusions: merged.exclusions,
                milestones: c.milestones,
                timelineSummary: merged.timelineSummary,
                terms: merged.terms,
                subtotalMinor: c.subtotalMinor,
                taxMinor: c.taxMinor,
                totalMinor: c.totalMinor,
                depositMinor: c.depositMinor,
                taxSnapshot: { enabled: tax.enabled, rateBps: tax.rateBps, label: tax.label, pricesIncludeTax: tax.pricesIncludeTax },
                expiresAt: changes.expiresInDays ? addDays(new Date(), changes.expiresInDays) : p.expiresAt,
                rowVersion: p.rowVersion + 1,
              })
              .where(and(eq(proposals.id, p.id), eq(proposals.rowVersion, rowVersion)))
              .returning();
            if (!rows[0]) throw conflict("Someone else changed this proposal. Reload and try again.", "version_conflict");
            await audit(tx, req, { action: "proposal.draft_updated", entityType: "proposal", entityId: p.id });
            return { id: p.id, version: p.version, newVersion: false };
          }
          // Sent/viewed/declined/expired → new version; previous becomes superseded.
          const version = (await latestVersionOf(tx, p.groupId)) + 1;
          const next = await insertVersion(tx, { groupId: p.groupId, reference: p.reference, version }, merged, { leadId: p.leadId, organizationId: p.organizationId, createdById: a.user.id });
          await tx.update(proposals).set({ status: "superseded" }).where(and(eq(proposals.groupId, p.groupId), ne(proposals.id, next.id), inArray(proposals.status, ["draft", "sent", "viewed", "declined", "expired", "withdrawn"])));
          await audit(tx, req, { action: "proposal.new_version", entityType: "proposal", entityId: next.id, after: { reference: p.reference, version } });
          return { id: next.id, version, newVersion: true };
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/proposals/:id/send",
      summary: "Send a draft to the client (freezes content, computes the acceptance fingerprint)",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: z.object({ rowVersion: z.number().int() }),
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const p = await loadForStaff(params.id, a);
        if (p.status !== "draft") throw new AppError(422, "invalid_transition", "Only drafts can be sent.");
        if (p.rowVersion !== body.rowVersion) throw conflict("This proposal changed since you loaded it.", "version_conflict");
        if (p.totalMinor <= 0) throw new AppError(422, "validation_failed", "Add priced line items before sending.");
        const result = await app.db.transaction(async (tx) => {
          let organizationId = p.organizationId;
          let clientUserId: string | null = null;
          let hasPassword = true;
          const [lead] = p.leadId ? await tx.select().from(leads).where(eq(leads.id, p.leadId)) : [null];
          if (lead) {
            const c = await findOrCreateClient(tx, { email: lead.email, name: lead.contactName, company: lead.companyName, phone: lead.phone });
            clientUserId = c.userId;
            hasPassword = c.hasPassword;
            organizationId = organizationId ?? c.organizationId;
            await tx.update(leads).set({ status: "proposal_sent", organizationId }).where(eq(leads.id, lead.id));
            await tx.insert(leadActivities).values({ leadId: lead.id, actorId: a.user.id, type: "proposal_event", body: `Proposal ${p.reference} v${p.version} sent`, metadata: { proposalId: p.id } });
          }
          if (!organizationId) throw new AppError(422, "validation_failed", "This proposal has no client to send to.");
          if (!clientUserId) {
            const [m] = await tx.execute<{ user_id: string }>(sql`select user_id from organization_members where organization_id = ${organizationId} order by created_at limit 1`).then((r) => r.rows);
            clientUserId = m?.user_id ?? null;
          }
          const now = new Date();
          const commerce = await app.settings.get("commerce", tx);
          const expiresAt = p.expiresAt && p.expiresAt > now ? p.expiresAt : addDays(now, commerce.proposalExpiryDays);
          const frozen = { ...p, organizationId, expiresAt };
          const contentHash = proposalContentHash(frozen);
          proposalMachine.assert(p.status, "sent");
          await tx.update(proposals).set({ status: "sent", sentAt: now, organizationId, expiresAt, contentHash, rowVersion: p.rowVersion + 1 }).where(eq(proposals.id, p.id));
          await audit(tx, req, { action: "proposal.sent", entityType: "proposal", entityId: p.id, after: { reference: p.reference, version: p.version, contentHash, totalMinor: p.totalMinor } });
          await track(tx, "proposal_sent", { userId: a.user.id, entityType: "proposal", entityId: p.id });
          if (clientUserId) {
            let path = `/portal/proposals/${p.id}`;
            if (!hasPassword) path = `/auth/magic?token=${await createAuthToken(tx, clientUserId, "invite")}&next=${encodeURIComponent(path)}`;
            await app.notifications.queue(tx, {
              template: "proposal.sent",
              userId: clientUserId,
              data: { title: p.title, reference: p.reference, version: p.version, totalMinor: p.totalMinor, depositMinor: p.depositMinor, expires: expiresAt.toISOString().slice(0, 10), path },
              dedupeKey: `proposal-sent:${p.id}`,
            });
          }
          return { ok: true as const, contentHash };
        });
        void app.notifications.dispatchPending();
        return result;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/proposals/:id/withdraw",
      summary: "Withdraw a sent proposal",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      handler: async ({ params, auth, req }) => {
        const p = await loadForStaff(params.id, requireUser(auth));
        if (!proposalMachine.can(p.status, "withdrawn")) throw new AppError(422, "invalid_transition", "This proposal can't be withdrawn.");
        await app.db.update(proposals).set({ status: "withdrawn", rowVersion: p.rowVersion + 1 }).where(eq(proposals.id, p.id));
        await audit(app.db, req, { action: "proposal.withdrawn", entityType: "proposal", entityId: p.id });
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/proposals/:id/messages",
      summary: "Reply in the proposal clarification thread",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: messageBody,
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const a = requireUser(auth);
        const p = await loadForStaff(params.id, a);
        return app.db.transaction(async (tx) => {
          const [m] = await tx.insert(messages).values({ threadType: "proposal", threadId: p.groupId, organizationId: p.organizationId, authorId: a.user.id, body: body.body, internal: body.internal }).returning();
          if (!body.internal && p.organizationId) {
            const [member] = await tx.execute<{ user_id: string }>(sql`select user_id from organization_members where organization_id = ${p.organizationId} order by created_at limit 1`).then((r) => r.rows);
            if (member) await app.notifications.queue(tx, { template: "message.new", userId: member.user_id, data: { subject: `Proposal ${p.reference}`, body: body.body, path: `/portal/proposals/${p.id}` } });
          }
          return m;
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/proposals/:id/pdf",
      summary: "Proposal PDF",
      tags: ["admin:proposals"],
      auth: "staff",
      permission: perm,
      params: idParams,
      rawResponse: { contentType: "application/pdf" },
      handler: async ({ params, auth, res }) => {
        const p = await loadForStaff(params.id, requireUser(auth));
        const pdf = await renderProposalPdf(p, (await app.settings.business()).tradingName);
        res.type("application/pdf").setHeader("content-disposition", `inline; filename="${p.reference}-v${p.version}.pdf"`);
        res.send(pdf);
      },
    }),
  ];
}

export function portalProposalRoutes(app: AppContext): RouteDef[] {
  async function loadForClient(userId: string, id: string) {
    const [p] = await app.db.select().from(proposals).where(eq(proposals.id, id));
    if (!p || p.status === "draft") throw notFound("Proposal");
    await assertOrgAccess(app.db, userId, p.organizationId, "Proposal");
    return p;
  }
  return [
    defineRoute({
      method: "get",
      path: "/portal/proposals",
      summary: "Proposals sent to my organisations",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        const rows = await app.db
          .select()
          .from(proposals)
          .where(and(inArray(proposals.organizationId, orgIds), ne(proposals.status, "draft")))
          .orderBy(desc(proposals.createdAt));
        const latest = new Map<string, number>();
        rows.forEach((r) => latest.set(r.groupId, Math.max(latest.get(r.groupId) ?? 0, r.version)));
        return rows.map((r) => toClientProposal(r, latest.get(r.groupId)!));
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/proposals/:id",
      summary: "A proposal version (marks it viewed) with its clarification thread",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      handler: async ({ params, auth, req }) => {
        const a = requireVerifiedClient(auth);
        let p = await loadForClient(a.user.id, params.id);
        if (p.status === "sent") {
          const [u] = await app.db.update(proposals).set({ status: "viewed", viewedAt: new Date() }).where(and(eq(proposals.id, p.id), eq(proposals.status, "sent"))).returning();
          if (u) {
            p = u;
            await track(app.db, "proposal_viewed", { userId: a.user.id, entityType: "proposal", entityId: p.id });
            await audit(app.db, req, { action: "proposal.viewed", entityType: "proposal", entityId: p.id });
          }
        }
        const latest = await latestVersionOf(app.db, p.groupId);
        const thread = await app.db
          .select({ id: messages.id, body: messages.body, createdAt: messages.createdAt, authorName: users.name, authorRole: users.role })
          .from(messages)
          .leftJoin(users, eq(users.id, messages.authorId))
          .where(and(eq(messages.threadType, "proposal"), eq(messages.threadId, p.groupId), eq(messages.internal, false)))
          .orderBy(messages.createdAt);
        const otherVersions = await app.db
          .select({ id: proposals.id, version: proposals.version, status: proposals.status })
          .from(proposals)
          .where(and(eq(proposals.groupId, p.groupId), ne(proposals.status, "draft")))
          .orderBy(desc(proposals.version));
        return { proposal: toClientProposal(p, latest), thread: thread.map((t) => ({ ...t, fromStudio: t.authorRole !== "client" })), versions: otherVersions };
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/proposals/:id/accept",
      summary: "Accept the exact proposal version (binds to its content hash) → order, project and deposit invoice",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: proposalDecisionBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireVerifiedClient(auth);
        if (body.proposalId !== params.id) throw new AppError(400, "bad_request", "Proposal mismatch.");
        await loadForClient(a.user.id, params.id);
        const result = await acceptProposal(app, req, a.user.id, params.id, body.contentHash);
        void app.notifications.dispatchPending();
        return result;
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/proposals/:id/decline",
      summary: "Decline a proposal",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: proposalDecisionBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireVerifiedClient(auth);
        const p = await loadForClient(a.user.id, params.id);
        if (!["sent", "viewed"].includes(p.status)) throw new AppError(422, "invalid_transition", "This proposal can no longer be declined.");
        if (p.contentHash !== body.contentHash) throw conflict("The proposal changed. Reload to see the current version.", "version_conflict");
        await app.db.transaction(async (tx) => {
          await tx.update(proposals).set({ status: "declined", declinedAt: new Date(), declineReason: body.reason ?? null }).where(eq(proposals.id, p.id));
          if (p.leadId) await tx.insert(leadActivities).values({ leadId: p.leadId, actorId: a.user.id, type: "proposal_event", body: `Proposal ${p.reference} v${p.version} declined${body.reason ? `: ${body.reason}` : ""}` });
          await audit(tx, req, { action: "proposal.declined", entityType: "proposal", entityId: p.id, reason: body.reason ?? null });
          await app.notifications.queueStaff(tx, { template: "proposal.decision", data: { reference: p.reference, version: p.version, decision: "declined", client: a.user.name, reason: body.reason, path: `/admin/proposals/${p.id}` } });
        });
        void app.notifications.dispatchPending();
        return { ok: true as const };
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/proposals/:id/messages",
      summary: "Ask a clarification question about a proposal",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: proposalClarifyBody,
      successStatus: 201,
      handler: async ({ params, body, auth }) => {
        const a = requireVerifiedClient(auth);
        const p = await loadForClient(a.user.id, params.id);
        const m = await app.db.transaction(async (tx) => {
          const [row] = await tx.insert(messages).values({ threadType: "proposal", threadId: p.groupId, organizationId: p.organizationId, authorId: a.user.id, body: body.body }).returning();
          if (p.leadId) await tx.insert(leadActivities).values({ leadId: p.leadId, actorId: a.user.id, type: "proposal_event", body: `Client question on ${p.reference}: ${body.body.slice(0, 500)}` });
          await app.notifications.queueStaff(tx, { template: "proposal.clarification", data: { reference: p.reference, body: body.body, path: `/admin/proposals/${p.id}` } });
          return row;
        });
        void app.notifications.dispatchPending();
        return { id: m.id, body: m.body, createdAt: m.createdAt };
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/proposals/:id/pdf",
      summary: "Download a proposal as PDF",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      rawResponse: { contentType: "application/pdf" },
      handler: async ({ params, auth, res }) => {
        const a = requireVerifiedClient(auth);
        const p = await loadForClient(a.user.id, params.id);
        const pdf = await renderProposalPdf(p, (await app.settings.business()).tradingName);
        res.type("application/pdf").setHeader("content-disposition", `attachment; filename="${p.reference}-v${p.version}.pdf"`);
        res.send(pdf);
      },
    }),
  ];
}
