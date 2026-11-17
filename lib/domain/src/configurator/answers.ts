import { z } from "zod/v4";

/**
 * Configurator answers. Drafts accept partial answers (`configuratorDraftAnswers`);
 * submissions must satisfy `configuratorSubmissionAnswers`.
 */

const shortText = z.string().trim().max(200);
const longText = z.string().trim().max(5000);
const key = z.string().regex(/^[a-z0-9_]+$/).max(64);

export const CONFIGURATOR_STEPS = [
  { key: "context", label: "About you" },
  { key: "problem", label: "The problem" },
  { key: "solution", label: "Solution type" },
  { key: "users", label: "Users & scale" },
  { key: "capabilities", label: "Capabilities" },
  { key: "integrations", label: "Integrations" },
  { key: "platforms", label: "Platforms & design" },
  { key: "migration", label: "Existing data" },
  { key: "budget", label: "Budget & timing" },
  { key: "review", label: "Review" },
] as const;
export type ConfiguratorStepKey = (typeof CONFIGURATOR_STEPS)[number]["key"];

export const contextAnswers = z.object({
  clientType: z.enum(["individual", "company"]),
  name: shortText.min(1, "Please tell us your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(254),
  phone: shortText.optional().default(""),
  company: shortText.optional().default(""),
  role: shortText.optional().default(""),
  industry: shortText.optional().default(""),
  country: z.string().trim().length(2).default("ZA"),
});

export const problemAnswers = z.object({
  description: longText.min(20, "A sentence or two helps us understand — at least 20 characters"),
  currentTools: longText.optional().default(""),
  successLooksLike: longText.optional().default(""),
});

export const solutionAnswers = z.object({
  types: z.array(key).min(1, "Choose at least one option (or “Not sure yet”)").max(8),
});

export const usersAnswers = z.object({
  internalBand: key,
  customerBand: key,
  roleBand: key,
  notes: longText.optional().default(""),
});

export const capabilitiesAnswers = z.object({
  features: z.array(key).max(80).default([]),
  notes: longText.optional().default(""),
});

export const integrationAnswer = z.object({
  key,
  vendor: shortText.optional().default(""),
  apiAvailable: z.enum(["yes", "no", "unknown"]).default("unknown"),
});

export const integrationsAnswers = z.object({
  items: z.array(integrationAnswer).max(30).default([]),
  other: longText.optional().default(""),
});

export const platformsAnswers = z.object({
  platforms: z.array(key).min(1, "Choose at least one platform").max(10),
  branding: key,
});

export const migrationAnswers = z.object({
  level: key,
  existingSystems: longText.optional().default(""),
  sourceOwnershipKnown: z.boolean().default(true),
  contentReady: z.enum(["yes", "partial", "no"]).default("partial"),
  hasDomainHosting: z.boolean().default(false),
});

export const budgetAnswers = z.object({
  budgetBand: key,
  launchTarget: key,
  urgency: key,
  notes: longText.optional().default(""),
});

export const reviewAnswers = z.object({
  contactPreference: z.enum(["email", "phone", "whatsapp"]).default("email"),
  consentProcessing: z.literal(true, { message: "We need your consent to process this brief" }),
  consentMarketing: z.boolean().default(false),
});

export const configuratorSubmissionAnswers = z.object({
  context: contextAnswers,
  problem: problemAnswers,
  solution: solutionAnswers,
  users: usersAnswers,
  capabilities: capabilitiesAnswers,
  integrations: integrationsAnswers,
  platforms: platformsAnswers,
  migration: migrationAnswers,
  budget: budgetAnswers,
  review: reviewAnswers,
});
export type ConfiguratorAnswers = z.infer<typeof configuratorSubmissionAnswers>;

/** Draft answers: every section optional, values loosely typed but size-bounded. */
export const configuratorDraftAnswers = z
  .object({
    context: contextAnswers.partial().optional(),
    problem: problemAnswers.partial().optional(),
    solution: solutionAnswers.partial().optional(),
    users: usersAnswers.partial().optional(),
    capabilities: capabilitiesAnswers.partial().optional(),
    integrations: integrationsAnswers.partial().optional(),
    platforms: platformsAnswers.partial().optional(),
    migration: migrationAnswers.partial().optional(),
    budget: budgetAnswers.partial().optional(),
    review: z
      .object({
        contactPreference: z.enum(["email", "phone", "whatsapp"]).optional(),
        consentProcessing: z.boolean().optional(),
        consentMarketing: z.boolean().optional(),
      })
      .optional(),
  })
  .strict();
export type ConfiguratorDraftAnswers = z.infer<typeof configuratorDraftAnswers>;

export const STEP_SCHEMAS = {
  context: contextAnswers,
  problem: problemAnswers,
  solution: solutionAnswers,
  users: usersAnswers,
  capabilities: capabilitiesAnswers,
  integrations: integrationsAnswers,
  platforms: platformsAnswers,
  migration: migrationAnswers,
  budget: budgetAnswers,
  review: reviewAnswers,
} as const;
