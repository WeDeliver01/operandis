import { boolean, index, jsonb, pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { ConfiguratorAnswers, ConfiguratorDraftAnswers, EstimateResult, LeadStatus, PricingRules } from "@workspace/domain";
import { createdAt, id, minor, ts, updatedAt } from "./common";
import { organizations, users } from "./identity";

export type LeadSource = "contact_form" | "configurator" | "package_enquiry" | "checkout" | "admin" | "discovery";

export const leads = pgTable(
  "leads",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    contactName: text("contact_name").notNull(),
    email: text("email").notNull(),
    emailNormalized: text("email_normalized").notNull(),
    phone: text("phone"),
    companyName: text("company_name"),
    jobTitle: text("job_title"),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    source: text("source").$type<LeadSource>().notNull(),
    interest: text("interest"),
    budgetBand: text("budget_band"),
    timeline: text("timeline"),
    summary: text("summary").notNull().default(""),
    consentProcessingAt: ts("consent_processing_at"),
    consentMarketing: boolean("consent_marketing").notNull().default(false),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status").$type<LeadStatus>().notNull().default("new"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    nextFollowUpAt: ts("next_follow_up_at"),
    lostReason: text("lost_reason"),
    /** Uncertain duplicate match (same email, different company) — flagged, never auto-merged. */
    possibleDuplicateOfId: uuid("possible_duplicate_of_id"),
    attribution: jsonb("attribution").$type<Record<string, string>>().notNull().default({}),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leads_email_idx").on(t.emailNormalized),
    index("leads_status_idx").on(t.status, t.createdAt),
    index("leads_owner_idx").on(t.ownerId),
    index("leads_follow_up_idx").on(t.nextFollowUpAt),
  ],
);

export type LeadActivityType =
  | "note"
  | "call"
  | "meeting"
  | "email"
  | "status_change"
  | "assignment"
  | "submission"
  | "enquiry"
  | "proposal_event"
  | "payment_event"
  | "order_event"
  | "system";

export const leadActivities = pgTable(
  "lead_activities",
  {
    id: id(),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    type: text("type").$type<LeadActivityType>().notNull(),
    body: text("body").notNull().default(""),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    occurredAt: ts("occurred_at").notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [index("lead_activities_lead_idx").on(t.leadId, t.occurredAt)],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    title: text("title").notNull(),
    notes: text("notes").notNull().default(""),
    leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    assigneeId: uuid("assignee_id").references(() => users.id, { onDelete: "set null" }),
    dueAt: ts("due_at"),
    completedAt: ts("completed_at"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("tasks_assignee_idx").on(t.assigneeId, t.completedAt), index("tasks_lead_idx").on(t.leadId), index("tasks_project_idx").on(t.projectId)],
);

export const pricingRuleVersions = pgTable(
  "pricing_rule_versions",
  {
    id: id(),
    version: minor("version").notNull().unique(),
    name: text("name").notNull(),
    status: text("status").$type<"draft" | "active" | "retired">().notNull().default("draft"),
    rules: jsonb("rules").$type<PricingRules>().notNull(),
    isDemo: boolean("is_demo").notNull().default(false),
    notes: text("notes").notNull().default(""),
    effectiveFrom: ts("effective_from"),
    createdById: uuid("created_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedById: uuid("approved_by_id").references(() => users.id, { onDelete: "set null" }),
    approvedAt: ts("approved_at"),
    /** Optimistic concurrency token. */
    rowVersion: minor("row_version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("pricing_rule_versions_status_idx").on(t.status)],
);

export const configuratorDrafts = pgTable(
  "configurator_drafts",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    answers: jsonb("answers").$type<ConfiguratorDraftAnswers>().notNull().default({}),
    currentStep: text("current_step").notNull().default("context"),
    email: text("email"),
    resumeEmailSentAt: ts("resume_email_sent_at"),
    expiresAt: ts("expires_at").notNull(),
    submittedAt: ts("submitted_at"),
    submissionId: uuid("submission_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("configurator_drafts_expiry_idx").on(t.expiresAt)],
);

export type SubmissionStatus = "submitted" | "under_review" | "estimate_ready" | "converted" | "closed";

export const configuratorSubmissions = pgTable(
  "configurator_submissions",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    leadId: uuid("lead_id").notNull().references(() => leads.id),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "set null" }),
    draftId: uuid("draft_id").references(() => configuratorDrafts.id, { onDelete: "set null" }),
    /** Immutable submitted answers (the versioned brief). */
    answers: jsonb("answers").$type<ConfiguratorAnswers>().notNull(),
    briefVersion: minor("brief_version").notNull().default(1),
    status: text("status").$type<SubmissionStatus>().notNull().default("submitted"),
    reviewNotes: text("review_notes").notNull().default(""),
    reviewedById: uuid("reviewed_by_id").references(() => users.id, { onDelete: "set null" }),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    submittedAt: ts("submitted_at").notNull().defaultNow(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("submissions_lead_idx").on(t.leadId), index("submissions_status_idx").on(t.status, t.createdAt)],
);

export const estimates = pgTable(
  "estimates",
  {
    id: id(),
    reference: text("reference").notNull().unique(),
    submissionId: uuid("submission_id").notNull().references(() => configuratorSubmissions.id),
    pricingRuleVersionId: uuid("pricing_rule_version_id").references(() => pricingRuleVersions.id),
    rulesVersion: minor("rules_version"),
    isDemoPricing: boolean("is_demo_pricing").notNull().default(false),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    lowMinor: minor("low_minor").notNull().default(0),
    highMinor: minor("high_minor").notNull().default(0),
    totalMinor: minor("total_minor").notNull().default(0),
    discoveryFeeMinor: minor("discovery_fee_minor").notNull().default(0),
    depositMinor: minor("deposit_minor").notNull().default(0),
    confidence: text("confidence").$type<"high" | "medium" | "low">().notNull(),
    requiresManualReview: boolean("requires_manual_review").notNull().default(false),
    recommendation: text("recommendation").$type<"intro_call" | "paid_discovery" | "package">().notNull(),
    /** Immutable snapshot of the full engine output, or null when no active rules existed. */
    result: jsonb("result").$type<EstimateResult | null>(),
    status: text("status").$type<"indicative" | "pending_rules" | "superseded">().notNull().default("indicative"),
    createdAt: createdAt(),
  },
  (t) => [index("estimates_submission_idx").on(t.submissionId)],
);
