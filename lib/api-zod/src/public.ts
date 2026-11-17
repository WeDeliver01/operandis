import { z } from "zod/v4";
import { configuratorDraftAnswers, configuratorSubmissionAnswers } from "@workspace/domain";
import { addressSchema, email, honeypot, name, optionKey, phone } from "./common";

// ---------------------------------------------------------------- portfolio
export const portfolioStatusLabel = z.enum(["live", "in_development", "concept", "internal_tool"]);
export const portfolioSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  shortDescription: z.string(),
  industry: z.string(),
  projectType: z.string(),
  statusLabel: portfolioStatusLabel,
  featured: z.boolean(),
  thumbnailUrl: z.string().nullable(),
  logoUrl: z.string().nullable(),
  externalUrl: z.string().nullable(),
  serviceCategorySlugs: z.array(z.string()),
  technologyTags: z.array(z.string()),
  displayOrder: z.number().int(),
});
export type PortfolioSummary = z.infer<typeof portfolioSummarySchema>;

export const portfolioDetailSchema = portfolioSummarySchema.extend({
  longDescription: z.string(),
  challenge: z.string(),
  approach: z.string(),
  solution: z.string(),
  features: z.array(z.string()),
  outcomes: z.array(z.string()),
  stack: z.string(),
  heroUrl: z.string().nullable(),
  gallery: z.array(z.object({ url: z.string(), caption: z.string().optional(), alt: z.string().optional() })),
  accessNote: z.string().nullable(),
  testimonial: z.object({ quote: z.string(), author: z.string(), role: z.string().optional(), company: z.string().optional() }).nullable(),
  bodyMarkdown: z.string(),
  seoTitle: z.string().nullable(),
  seoDescription: z.string().nullable(),
});
export type PortfolioDetail = z.infer<typeof portfolioDetailSchema>;

export const portfolioListQuery = z.object({
  category: z.string().max(80).optional(),
  featured: z.enum(["true", "false"]).optional(),
});

// ---------------------------------------------------------------- services, faqs
export const serviceCategorySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  eyebrow: z.string(),
  headline: z.string(),
  summary: z.string(),
  description: z.string(),
  audiences: z.array(z.string()),
  deliverables: z.array(z.string()),
  displayOrder: z.number().int(),
});
export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

export const faqSchema = z.object({ id: z.uuid(), scope: z.string(), question: z.string(), answer: z.string(), displayOrder: z.number().int() });
export type Faq = z.infer<typeof faqSchema>;

// ---------------------------------------------------------------- packages
export const depositRuleSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("full") }),
  z.object({ type: z.literal("none") }),
  z.object({ type: z.literal("percent"), percentBps: z.number().int().min(0).max(10_000) }),
  z.object({ type: z.literal("fixed"), amountMinor: z.number().int().min(0) }),
]);

export const packageVariantSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  priceMinor: z.number().int(),
  deliveryWindow: z.string(),
  inclusions: z.array(z.string()),
  recommended: z.boolean(),
  active: z.boolean(),
  displayOrder: z.number().int(),
});
export const packageOptionSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string(),
  pricingType: z.enum(["fixed", "per_unit", "manual_review"]),
  amountMinor: z.number().int(),
  unitLabel: z.string().nullable(),
  minQty: z.number().int(),
  maxQty: z.number().int(),
  rules: z.object({ requires: z.array(z.string()), excludes: z.array(z.string()), variants: z.array(z.string()) }),
  active: z.boolean(),
  displayOrder: z.number().int(),
});

export const packageSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  summary: z.string(),
  audience: z.enum(["b2b", "b2c", "both"]),
  categorySlug: z.string().nullable(),
  pricingMode: z.enum(["fixed", "starting_from", "quote_only"]),
  /** Lowest purchasable price (variant minimum or base price). */
  fromPriceMinor: z.number().int(),
  currency: z.literal("ZAR"),
  deliveryWindow: z.string(),
  isDiscovery: z.boolean(),
  featured: z.boolean(),
  status: z.enum(["draft", "published", "paused", "archived"]),
  soldOut: z.boolean(),
  displayOrder: z.number().int(),
});
export type PackageSummary = z.infer<typeof packageSummarySchema>;

export const packageDetailSchema = packageSummarySchema.extend({
  description: z.string(),
  priceMinor: z.number().int(),
  deliverables: z.array(z.string()),
  inclusions: z.array(z.string()),
  exclusions: z.array(z.string()),
  clientResponsibilities: z.array(z.string()),
  nextSteps: z.array(z.string()),
  revisions: z.string(),
  warrantySupport: z.string(),
  eligibility: z.string(),
  cancellationTerms: z.string(),
  deposit: depositRuleSchema,
  capacityLimit: z.number().int().nullable(),
  version: z.number().int(),
  variants: z.array(packageVariantSchema),
  options: z.array(packageOptionSchema),
  faqs: z.array(faqSchema),
});
export type PackageDetail = z.infer<typeof packageDetailSchema>;

export const packageSelectionSchema = z.object({
  variantKey: optionKey.nullable().optional(),
  options: z.array(z.object({ key: optionKey, quantity: z.number().int().min(1).max(1000) })).max(40).default([]),
});
export type PackageSelectionInput = z.infer<typeof packageSelectionSchema>;

export const packageQuoteSchema = z.object({
  currency: z.literal("ZAR"),
  lines: z.array(z.object({ kind: z.string(), key: z.string(), description: z.string(), quantity: z.number().int(), unitMinor: z.number().int(), totalMinor: z.number().int() })),
  subtotalMinor: z.number().int(),
  taxMinor: z.number().int(),
  totalMinor: z.number().int(),
  depositMinor: z.number().int(),
  dueNowMinor: z.number().int(),
  balanceMinor: z.number().int(),
  purchasable: z.boolean(),
  requiresQuoteReasons: z.array(z.string()),
  taxLabel: z.string().nullable(),
});
export type PackageQuoteDto = z.infer<typeof packageQuoteSchema>;

export const packageEnquiryBody = z.object({
  selection: packageSelectionSchema,
  name,
  email,
  phone: phone.optional(),
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().max(4000).optional().default(""),
  consentProcessing: z.literal(true, { message: "Consent is required to process your enquiry" }),
  consentMarketing: z.boolean().default(false),
  website: honeypot,
});

// ---------------------------------------------------------------- checkout
export const checkoutBody = z.object({
  packageSlug: z.string().max(80),
  /** The package version the visitor saw; a mismatch returns 409 so they can review the new price. */
  expectedVersion: z.number().int().optional(),
  selection: packageSelectionSchema,
  billing: z.object({
    name,
    email,
    phone: phone.optional(),
    company: z.string().trim().max(160).optional(),
    vatNumber: z.string().trim().max(40).optional(),
    address: addressSchema.optional(),
  }),
  acceptTerms: z.literal(true, { message: "Please accept the terms and scope to continue" }),
  termsVersion: z.string().max(40),
  provider: z.enum(["payfast", "yoco", "eft"]).optional(),
  /** Links a discovery purchase to a configurator brief. */
  submissionReference: z.string().max(40).optional(),
  idempotencyKey: z.string().min(16).max(100),
  website: honeypot,
});
export type CheckoutBody = z.infer<typeof checkoutBody>;

export const paymentRedirectSchema = z.object({
  attemptId: z.uuid(),
  reference: z.string(),
  provider: z.enum(["payfast", "yoco", "eft"]),
  /** For form-post gateways (PayFast) the browser must POST these fields to `url`. */
  method: z.enum(["GET", "POST", "NONE"]),
  url: z.string().nullable(),
  fields: z.record(z.string(), z.string()).nullable(),
  /** EFT instructions when provider = eft. */
  eft: z
    .object({ bankName: z.string(), accountName: z.string(), accountNumber: z.string(), branchCode: z.string(), accountType: z.string(), reference: z.string(), amountMinor: z.number().int() })
    .nullable(),
});
export type PaymentRedirect = z.infer<typeof paymentRedirectSchema>;

export const checkoutResponseSchema = z.object({
  orderId: z.uuid(),
  orderReference: z.string(),
  accessToken: z.string().describe("Opaque token allowing the purchaser to view this order's status without logging in."),
  payment: paymentRedirectSchema,
});
export type CheckoutResponse = z.infer<typeof checkoutResponseSchema>;

export const orderStatusSchema = z.object({
  orderReference: z.string(),
  status: z.string(),
  paymentStatus: z.enum(["pending", "succeeded", "failed", "cancelled", "pending_verification", "expired", "created", "redirected"]),
  totalMinor: z.number().int(),
  dueNowMinor: z.number().int(),
  packageName: z.string().nullable(),
  provider: z.string().nullable(),
  failureReason: z.string().nullable(),
  canRetry: z.boolean(),
});
export type OrderStatusDto = z.infer<typeof orderStatusSchema>;

// ---------------------------------------------------------------- contact
export const contactBody = z.object({
  name,
  email,
  phone: phone.optional(),
  company: z.string().trim().max(160).optional(),
  topic: z.enum(["new_project", "package_question", "existing_client", "partnership", "other"]).default("new_project"),
  message: z.string().trim().min(10, "Tell us a little more (at least 10 characters)").max(5000),
  budgetBand: z.string().max(40).optional(),
  consentProcessing: z.literal(true, { message: "Consent is required so we can respond" }),
  consentMarketing: z.boolean().default(false),
  attribution: z.record(z.string().max(40), z.string().max(200)).optional(),
  website: honeypot,
});

// ---------------------------------------------------------------- configurator
export const draftCreateBody = z.object({ answers: configuratorDraftAnswers.default({}), currentStep: z.string().max(40).default("context") });
export const draftUpdateBody = z.object({
  answers: configuratorDraftAnswers,
  currentStep: z.string().max(40),
  sendResumeLink: z.boolean().optional(),
});
export const draftResponseSchema = z.object({
  token: z.string().optional(),
  answers: configuratorDraftAnswers,
  currentStep: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  submitted: z.boolean(),
  submissionReference: z.string().nullable(),
});

export const submissionBody = z.object({
  draftToken: z.string().max(200).optional(),
  answers: configuratorSubmissionAnswers,
  idempotencyKey: z.string().min(16).max(100),
  attribution: z.record(z.string().max(40), z.string().max(200)).optional(),
  website: honeypot,
});
export type SubmissionBody = z.infer<typeof submissionBody>;

export const estimateViewSchema = z.object({
  submissionReference: z.string(),
  estimateReference: z.string().nullable(),
  createdAt: z.string(),
  status: z.string(),
  isDemoPricing: z.boolean(),
  rulesVersion: z.number().int().nullable(),
  /** Full engine output (null when pricing rules are not yet approved). */
  result: z.any().nullable(),
  summary: z.object({
    name: z.string(),
    company: z.string(),
    solutionLabels: z.array(z.string()),
    featureLabels: z.array(z.string()),
    integrationLabels: z.array(z.string()),
    platformLabels: z.array(z.string()),
  }),
  discoveryPackageSlug: z.string().nullable(),
  accessToken: z.string().optional(),
});
export type EstimateView = z.infer<typeof estimateViewSchema>;

// ---------------------------------------------------------------- analytics
export const analyticsEventBody = z.object({
  name: z.string().max(60),
  anonymousId: z.string().max(64),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
  properties: z.record(z.string().max(40), z.union([z.string().max(200), z.number(), z.boolean()])).optional(),
});

// ---------------------------------------------------------------- public settings
export const publicSettingsSchema = z.object({
  business: z.object({
    tradingName: z.string(),
    legalName: z.string(),
    email: z.string(),
    legalEmail: z.string(),
    phone: z.string(),
    address: z.array(z.string()),
    hours: z.array(z.string()),
    calLink: z.string(),
    linkedinUrl: z.string(),
  }),
  commerce: z.object({
    currency: z.literal("ZAR"),
    termsVersion: z.string(),
    refundPolicySummary: z.string(),
    paymentProviders: z.array(z.enum(["payfast", "yoco", "eft"])),
    taxLabel: z.string().nullable(),
    pricesShownIncludeTax: z.boolean(),
  }),
  configurator: z.object({ enabled: z.boolean(), demoPricing: z.boolean(), pricingActive: z.boolean() }),
});
export type PublicSettings = z.infer<typeof publicSettingsSchema>;
