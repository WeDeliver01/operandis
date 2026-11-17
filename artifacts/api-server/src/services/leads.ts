import type { Request } from "express";
import { desc, eq } from "drizzle-orm";
import { leadActivities, leads, organizationMembers, users, type DbOrTx, type LeadSource } from "@workspace/db";
import { nextNumber, normalizeEmail } from "../lib/db-helpers";
import { audit } from "./audit";
import type { AppContext } from "../context";

export interface LeadInput {
  source: LeadSource;
  contactName: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
  jobTitle?: string | null;
  interest?: string | null;
  budgetBand?: string | null;
  timeline?: string | null;
  summary: string;
  consentMarketing?: boolean;
  attribution?: Record<string, string>;
  /** Skip the staff alert (e.g. when the caller sends a richer one). */
  silent?: boolean;
}

const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Capture a lead with deduplication:
 *  - same normalised email and compatible company → reuse the lead, append activity
 *  - same email but a different, non-empty company → create a new lead flagged as a
 *    possible duplicate (never auto-merged: the match is uncertain)
 */
export async function captureLead(app: AppContext, tx: DbOrTx, req: Request | null, input: LeadInput) {
  const emailNormalized = normalizeEmail(input.email);
  const [existing] = await tx.select().from(leads).where(eq(leads.emailNormalized, emailNormalized)).orderBy(desc(leads.createdAt)).limit(1);

  const [user] = await tx.select({ id: users.id }).from(users).where(eq(users.emailNormalized, emailNormalized));
  let organizationId: string | null = null;
  if (user) {
    const [m] = await tx.select({ orgId: organizationMembers.organizationId }).from(organizationMembers).where(eq(organizationMembers.userId, user.id)).limit(1);
    organizationId = m?.orgId ?? null;
  }

  const companyConflict = existing && norm(existing.companyName) && norm(input.companyName) && norm(existing.companyName) !== norm(input.companyName);

  if (existing && !companyConflict) {
    const patch: Partial<typeof leads.$inferInsert> = {};
    if (!existing.phone && input.phone) patch.phone = input.phone;
    if (!existing.companyName && input.companyName) patch.companyName = input.companyName;
    if (!existing.jobTitle && input.jobTitle) patch.jobTitle = input.jobTitle;
    if (input.budgetBand) patch.budgetBand = input.budgetBand;
    if (input.timeline) patch.timeline = input.timeline;
    if (input.interest) patch.interest = input.interest;
    if (input.consentMarketing) patch.consentMarketing = true;
    if (!existing.userId && user) patch.userId = user.id;
    if (!existing.organizationId && organizationId) patch.organizationId = organizationId;
    patch.consentProcessingAt = new Date();
    if (existing.status === "lost") patch.status = "new";
    await tx.update(leads).set(patch).where(eq(leads.id, existing.id));
    await tx.insert(leadActivities).values({
      leadId: existing.id,
      type: "system",
      body: `Returning contact via ${input.source.replace("_", " ")}`,
      metadata: { source: input.source, summary: input.summary.slice(0, 2000) },
    });
    if (!input.silent) await alertStaff(app, tx, existing.reference, existing.id, input);
    return { ...existing, ...patch, isNew: false };
  }

  const reference = await nextNumber(tx, "LD");
  const [lead] = await tx
    .insert(leads)
    .values({
      reference,
      contactName: input.contactName,
      email: input.email.trim(),
      emailNormalized,
      phone: input.phone ?? null,
      companyName: input.companyName || null,
      jobTitle: input.jobTitle || null,
      userId: user?.id ?? null,
      organizationId,
      source: input.source,
      interest: input.interest ?? null,
      budgetBand: input.budgetBand ?? null,
      timeline: input.timeline ?? null,
      summary: input.summary.slice(0, 10_000),
      consentProcessingAt: new Date(),
      consentMarketing: input.consentMarketing ?? false,
      possibleDuplicateOfId: companyConflict ? existing!.id : null,
      attribution: input.attribution ?? {},
    })
    .returning();
  await tx.insert(leadActivities).values({ leadId: lead.id, type: "system", body: `Lead created from ${input.source.replace("_", " ")}`, metadata: { source: input.source } });
  await audit(tx, req, { action: "lead.created", entityType: "lead", entityId: lead.id, after: { source: input.source, reference } });
  if (!input.silent) await alertStaff(app, tx, reference, lead.id, input);
  return { ...lead, isNew: true };
}

async function alertStaff(app: AppContext, tx: DbOrTx, reference: string, leadId: string, input: LeadInput) {
  await app.notifications.queueStaff(tx, {
    template: "staff.new_lead",
    data: { reference, name: input.contactName, email: input.email, company: input.companyName, source: input.source.replace("_", " "), summary: input.summary, path: `/admin/leads/${leadId}` },
  });
}
