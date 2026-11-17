import { z } from "zod/v4";
import { CHANGE_REQUEST_STATUSES, LEAD_STATUSES, MILESTONE_STATUSES, PROJECT_STATUSES, ROLES, pricingRulesSchema } from "@workspace/domain";
import { bps, email, minorAmount, name, optionKey, phone, slug, stringList } from "./common";
import { depositRuleSchema, portfolioStatusLabel } from "./public";

// ---------------------------------------------------------------- CRM
export const leadSource = z.enum(["contact_form", "configurator", "package_enquiry", "checkout", "admin", "discovery"]);
export const leadListQuery = z.object({
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  q: z.string().trim().max(200).optional(),
  status: z.enum(LEAD_STATUSES).optional(),
  ownerId: z.union([z.uuid(), z.literal("me"), z.literal("unassigned")]).optional(),
  source: leadSource.optional(),
  followUpDue: z.enum(["true"]).optional(),
});
export const leadCreateBody = z.object({
  contactName: name,
  email,
  phone: phone.optional(),
  companyName: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(120).optional(),
  interest: z.string().trim().max(200).optional(),
  budgetBand: z.string().trim().max(60).optional(),
  timeline: z.string().trim().max(60).optional(),
  summary: z.string().trim().max(5000).default(""),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  ownerId: z.uuid().nullable().optional(),
});
export const leadUpdateBody = leadCreateBody
  .partial()
  .extend({
    status: z.enum(LEAD_STATUSES).optional(),
    lostReason: z.string().trim().max(500).nullable().optional(),
    nextFollowUpAt: z.iso.datetime({ offset: true }).nullable().optional(),
    possibleDuplicateOfId: z.uuid().nullable().optional(),
  });
export const leadActivityBody = z.object({
  type: z.enum(["note", "call", "meeting", "email"]),
  body: z.string().trim().min(1).max(10_000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
});
export const taskBody = z.object({
  title: z.string().trim().min(1).max(200),
  notes: z.string().trim().max(5000).default(""),
  leadId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
});
export const taskUpdateBody = taskBody.partial().extend({ completed: z.boolean().optional() });
export const submissionReviewBody = z.object({
  status: z.enum(["submitted", "under_review", "estimate_ready", "converted", "closed"]).optional(),
  reviewNotes: z.string().trim().max(10_000).optional(),
});

// ---------------------------------------------------------------- catalogue
export const packageUpsertBody = z.object({
  slug,
  name: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(500).default(""),
  description: z.string().trim().max(10_000).default(""),
  audience: z.enum(["b2b", "b2c", "both"]).default("both"),
  categorySlug: z.string().max(80).nullable().default(null),
  pricingMode: z.enum(["fixed", "starting_from", "quote_only"]),
  priceMinor: minorAmount,
  deliveryWindow: z.string().trim().max(80).default(""),
  deliverables: stringList.default([]),
  inclusions: stringList.default([]),
  exclusions: stringList.default([]),
  clientResponsibilities: stringList.default([]),
  nextSteps: stringList.default([]),
  revisions: z.string().trim().max(500).default(""),
  warrantySupport: z.string().trim().max(500).default(""),
  eligibility: z.string().trim().max(500).default(""),
  cancellationTerms: z.string().trim().max(2000).default(""),
  deposit: depositRuleSchema,
  capacityLimit: z.number().int().min(0).nullable().default(null),
  isDiscovery: z.boolean().default(false),
  featured: z.boolean().default(false),
  displayOrder: z.number().int().default(0),
});
export const packageStatusBody = z.object({ status: z.enum(["draft", "published", "paused", "archived"]) });
export const variantUpsertBody = z.object({
  key: optionKey,
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(1000).default(""),
  priceMinor: minorAmount,
  deliveryWindow: z.string().trim().max(80).default(""),
  inclusions: stringList.default([]),
  recommended: z.boolean().default(false),
  active: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
});
export const optionUpsertBody = z
  .object({
    key: optionKey,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).default(""),
    pricingType: z.enum(["fixed", "per_unit", "manual_review"]),
    amountMinor: minorAmount,
    unitLabel: z.string().trim().max(40).nullable().default(null),
    minQty: z.number().int().min(0).max(1000).default(1),
    maxQty: z.number().int().min(1).max(1000).default(1),
    rules: z
      .object({ requires: z.array(optionKey).default([]), excludes: z.array(optionKey).default([]), variants: z.array(optionKey).default([]) })
      .default({ requires: [], excludes: [], variants: [] }),
    active: z.boolean().default(true),
    displayOrder: z.number().int().default(0),
  })
  .refine((o) => o.maxQty >= o.minQty, { message: "Max quantity must be ≥ min quantity", path: ["maxQty"] });

// ---------------------------------------------------------------- pricing
export const pricingVersionCreateBody = z.object({
  name: z.string().trim().min(1).max(120),
  notes: z.string().trim().max(5000).default(""),
  rules: pricingRulesSchema,
  /** Copy from an existing version when rules omitted in UI (server just uses `rules`). */
  isDemo: z.boolean().default(false),
});
export const pricingVersionUpdateBody = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  notes: z.string().trim().max(5000).optional(),
  rules: pricingRulesSchema.optional(),
  rowVersion: z.number().int(),
});
export const pricingActivateBody = z.object({ rowVersion: z.number().int(), effectiveFrom: z.iso.datetime({ offset: true }).optional() });

// ---------------------------------------------------------------- content
export const portfolioUpsertBody = z.object({
  slug,
  title: z.string().trim().min(1).max(160),
  shortDescription: z.string().trim().max(500).default(""),
  longDescription: z.string().trim().max(20_000).default(""),
  challenge: z.string().trim().max(10_000).default(""),
  approach: z.string().trim().max(10_000).default(""),
  solution: z.string().trim().max(10_000).default(""),
  features: stringList.default([]),
  outcomes: stringList.default([]),
  industry: z.string().trim().max(120).default(""),
  projectType: z.string().trim().max(120).default(""),
  stack: z.string().trim().max(500).default(""),
  technologyTags: z.array(z.string().trim().min(1).max(40)).max(40).default([]),
  serviceCategorySlugs: z.array(z.string().max(80)).max(10).default([]),
  thumbnailUrl: z.string().trim().max(500).nullable().default(null),
  heroUrl: z.string().trim().max(500).nullable().default(null),
  logoUrl: z.string().trim().max(500).nullable().default(null),
  gallery: z.array(z.object({ url: z.string().max(500), caption: z.string().max(300).optional(), alt: z.string().max(300).optional() })).max(30).default([]),
  externalUrl: z.url().max(500).nullable().default(null),
  accessNote: z.string().trim().max(300).nullable().default(null),
  featured: z.boolean().default(false),
  statusLabel: portfolioStatusLabel,
  publicationStatus: z.enum(["draft", "published", "archived"]),
  displayOrder: z.number().int().default(0),
  testimonial: z.object({ quote: z.string().max(2000), author: z.string().max(120), role: z.string().max(120).optional(), company: z.string().max(120).optional() }).nullable().default(null),
  bodyMarkdown: z.string().max(100_000).default(""),
  seoTitle: z.string().trim().max(160).nullable().default(null),
  seoDescription: z.string().trim().max(320).nullable().default(null),
});
export const serviceUpsertBody = z.object({
  slug,
  name: z.string().trim().min(1).max(120),
  eyebrow: z.string().trim().max(80).default(""),
  headline: z.string().trim().max(200).default(""),
  summary: z.string().trim().max(1000).default(""),
  description: z.string().trim().max(10_000).default(""),
  audiences: stringList.default([]),
  deliverables: stringList.default([]),
  displayOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});
export const faqUpsertBody = z.object({
  scope: z.string().trim().min(1).max(100),
  question: z.string().trim().min(1).max(500),
  answer: z.string().trim().min(1).max(5000),
  displayOrder: z.number().int().default(0),
  published: z.boolean().default(true),
});

// ---------------------------------------------------------------- proposals
export const proposalMilestoneInput = z.object({
  key: optionKey,
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().max(2000).default(""),
  percentBps: bps,
  targetOffsetDays: z.number().int().min(0).max(1000).default(0),
});
export const proposalBody = z.object({
  leadId: z.uuid().nullable().optional(),
  organizationId: z.uuid().nullable().optional(),
  submissionId: z.uuid().nullable().optional(),
  estimateId: z.uuid().nullable().optional(),
  title: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(10_000).default(""),
  sections: z.array(z.object({ heading: z.string().trim().min(1).max(200), body: z.string().trim().max(20_000) })).max(30).default([]),
  lineItems: z
    .array(z.object({ description: z.string().trim().min(1).max(500), quantity: z.number().int().min(1).max(10_000), unitMinor: minorAmount }))
    .min(1, "Add at least one line item")
    .max(100),
  assumptions: stringList.default([]),
  exclusions: stringList.default([]),
  milestones: z.array(proposalMilestoneInput).min(1).max(20),
  depositMilestoneKey: optionKey.optional(),
  timelineSummary: z.string().trim().max(2000).default(""),
  terms: z.string().trim().max(50_000).default(""),
  expiresInDays: z.number().int().min(1).max(365).default(30),
});
export type ProposalBody = z.infer<typeof proposalBody>;
export const proposalUpdateBody = proposalBody.partial().extend({ rowVersion: z.number().int() });
export const proposalFromSubmissionBody = z.object({ submissionId: z.uuid() });

export const proposalDecisionBody = z.object({
  /** The version id the client is looking at; must still be current. */
  proposalId: z.uuid(),
  contentHash: z.string().length(64),
  confirm: z.literal(true),
  reason: z.string().trim().max(2000).optional(),
});
export const proposalClarifyBody = z.object({ body: z.string().trim().min(1).max(5000) });

// ---------------------------------------------------------------- finance
export const invoiceCreateBody = z.object({
  organizationId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  projectId: z.uuid().nullable().optional(),
  milestoneId: z.uuid().nullable().optional(),
  kind: z.enum(["deposit", "milestone", "full", "balance", "retainer", "discovery", "other"]),
  lines: z.array(z.object({ description: z.string().trim().min(1).max(500), quantity: z.number().int().min(1), unitMinor: minorAmount })).min(1).max(100),
  dueInDays: z.number().int().min(0).max(365).default(14),
  notes: z.string().trim().max(2000).default(""),
});
export const invoiceVoidBody = z.object({ reason: z.string().trim().min(5).max(1000) });
export const offlinePaymentBody = z.object({
  amountMinor: z.number().int().min(1),
  bankReference: z.string().trim().min(2).max(120),
  receivedAt: z.iso.datetime({ offset: true }),
  note: z.string().trim().max(1000).default(""),
  attemptId: z.uuid().optional(),
});
export const refundBody = z.object({
  amountMinor: z.number().int().min(1),
  reason: z.string().trim().min(5, "Give a reason (at least 5 characters)").max(2000),
  idempotencyKey: z.string().min(16).max(100),
});

// ---------------------------------------------------------------- delivery
export const projectCreateBody = z.object({
  organizationId: z.uuid(),
  orderId: z.uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  summary: z.string().trim().max(5000).default(""),
  managerId: z.uuid().nullable().optional(),
  depositRequired: z.boolean().default(false),
  contractValueMinor: minorAmount.default(0),
  targetDate: z.iso.datetime({ offset: true }).nullable().optional(),
});
export const projectUpdateBody = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  summary: z.string().trim().max(5000).optional(),
  status: z.enum(PROJECT_STATUSES).optional(),
  managerId: z.uuid().nullable().optional(),
  progressPct: z.number().int().min(0).max(100).optional(),
  startDate: z.iso.datetime({ offset: true }).nullable().optional(),
  targetDate: z.iso.datetime({ offset: true }).nullable().optional(),
});
export const depositExceptionBody = z.object({ reason: z.string().trim().min(10, "Explain the exception (at least 10 characters)").max(2000) });
export const milestoneBody = z.object({
  key: optionKey,
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).default(""),
  amountMinor: minorAmount.default(0),
  billable: z.boolean().default(false),
  visibility: z.enum(["client", "internal"]).default("client"),
  targetDate: z.iso.datetime({ offset: true }).nullable().optional(),
  displayOrder: z.number().int().default(0),
});
export const milestoneUpdateBody = milestoneBody.partial().extend({ status: z.enum(MILESTONE_STATUSES).optional() });
export const messageBody = z.object({
  body: z.string().trim().min(1).max(10_000),
  internal: z.boolean().default(false),
  kind: z.enum(["message", "update"]).default("message"),
});
export const changeRequestBody = z.object({
  projectId: z.uuid(),
  type: z.enum(["defect", "change", "support", "question"]),
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(10_000),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
});
export const changeRequestUpdateBody = z.object({
  status: z.enum(CHANGE_REQUEST_STATUSES).optional(),
  response: z.string().trim().max(10_000).optional(),
  impactEstimateMinor: minorAmount.nullable().optional(),
  impactDays: z.number().int().min(0).max(1000).nullable().optional(),
  assigneeId: z.uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
});
export const changeRequestDecisionBody = z.object({ decision: z.enum(["approve", "reject"]) });
export const fileMetaBody = z.object({
  projectId: z.uuid().optional(),
  kind: z.enum(["deliverable", "document", "client_upload", "eft_proof"]).optional(),
  visibility: z.enum(["client", "internal"]).optional(),
  description: z.string().trim().max(500).optional(),
  attemptId: z.uuid().optional(),
});

// ---------------------------------------------------------------- users & settings
export const userCreateBody = z.object({
  name,
  email,
  role: z.enum(ROLES),
  sendInvite: z.boolean().default(true),
  organizationName: z.string().trim().max(160).optional(),
});
export const userUpdateBody = z.object({
  name: name.optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const businessSettings = z.object({
  tradingName: z.string().trim().min(1).max(120),
  legalName: z.string().trim().max(200),
  registrationNumber: z.string().trim().max(60),
  email: email,
  legalEmail: email,
  phone: z.string().trim().max(40),
  address: z.array(z.string().trim().max(200)).max(6),
  hours: z.array(z.string().trim().max(200)).max(6),
  calLink: z.string().trim().max(200),
  linkedinUrl: z.string().trim().max(300),
  staffAlertEmails: z.array(email).max(10),
});
export const taxSettings = z.object({
  enabled: z.boolean(),
  rateBps: bps,
  label: z.string().trim().max(20),
  pricesIncludeTax: z.boolean(),
  vatNumber: z.string().trim().max(40).nullable(),
  /** Must be set to true by the owner once an accountant has confirmed VAT treatment. */
  confirmedByOwner: z.boolean(),
});
export const commerceSettings = z.object({
  termsVersion: z.string().trim().min(1).max(40),
  termsSummary: z.string().trim().max(5000),
  refundPolicySummary: z.string().trim().max(5000),
  invoiceDueDays: z.number().int().min(0).max(120),
  proposalExpiryDays: z.number().int().min(1).max(365),
  defaultDepositBps: bps,
  enabledProviders: z.array(z.enum(["payfast", "yoco", "eft"])).max(3),
  defaultProvider: z.enum(["payfast", "yoco", "eft"]).nullable(),
  eft: z.object({
    bankName: z.string().trim().max(80),
    accountName: z.string().trim().max(120),
    accountNumber: z.string().trim().max(40),
    branchCode: z.string().trim().max(20),
    accountType: z.string().trim().max(40),
  }),
});
export const securitySettings = z.object({ requireStaffMfa: z.boolean(), sessionDays: z.number().int().min(1).max(90) });
export const configuratorSettings = z.object({ enabled: z.boolean() });

export const SETTINGS_SCHEMAS = {
  business: businessSettings,
  tax: taxSettings,
  commerce: commerceSettings,
  security: securitySettings,
  configurator: configuratorSettings,
} as const;
export type SettingsKey = keyof typeof SETTINGS_SCHEMAS;
export type BusinessSettings = z.infer<typeof businessSettings>;
export type TaxSettings = z.infer<typeof taxSettings>;
export type CommerceSettings = z.infer<typeof commerceSettings>;
export type SecuritySettings = z.infer<typeof securitySettings>;
/** Settings that only the owner may change. */
export const HIGH_RISK_SETTINGS: SettingsKey[] = ["tax", "security"];
