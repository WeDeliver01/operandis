import { z } from "zod/v4";

/**
 * Versioned, admin-editable pricing rules for the custom-software configurator.
 * Every coefficient lives here (stored as JSON in `pricing_rule_versions.rules`),
 * never as UI constants. Amounts are minor units (ZAR cents); ratios are basis points.
 */

const key = z.string().regex(/^[a-z0-9_]+$/, "keys are lowercase snake_case").min(1).max(64);
const minor = z.number().int().min(0);
const bps = z.number().int().min(0).max(100_000);
const weeks = z.number().int().min(0).max(520);

export const complexityLevel = z.enum(["low", "medium", "high"]);

export const solutionRule = z.object({
  key,
  label: z.string().min(1),
  description: z.string().default(""),
  examples: z.array(z.string()).default([]),
  baseMinor: minor,
  complexityPoints: z.number().int().min(0).default(0),
  minWeeks: weeks,
  maxWeeks: weeks,
  /** Marks options such as "Not sure yet" that cannot be priced automatically. */
  unpriced: z.boolean().default(false),
});

export const featureGroupRule = z.object({
  key,
  label: z.string(),
  description: z.string().default(""),
});

export const reviewFlagCode = z.enum([
  "unclear_solution",
  "contradictory_requirements",
  "many_platforms",
  "many_integrations",
  "native_mobile",
  "offline_mode",
  "sensitive_data",
  "regulated_workflow",
  "large_migration",
  "unknown_source_system",
  "budget_below_estimate",
  "timeline_conflict",
  "above_auto_threshold",
  "low_confidence",
  "unpriced_items",
]);
export type ReviewFlagCode = z.infer<typeof reviewFlagCode>;

export const featureRule = z.object({
  key,
  groupKey: key,
  label: z.string(),
  description: z.string().default(""),
  /** Solution keys this feature is offered for. Empty = all solutions. */
  solutions: z.array(key).default([]),
  amountMinor: minor,
  weeks: z.number().min(0).max(52).default(0),
  complexityPoints: z.number().int().min(0).default(1),
  /** Features that must also be selected (enforced server-side). */
  requires: z.array(key).default([]),
  /** Raised as manual-review flags when selected. */
  flags: z.array(reviewFlagCode).default([]),
});

export const integrationRule = z.object({
  key,
  label: z.string(),
  examples: z.array(z.string()).default([]),
  amountMinor: minor,
  complexityPoints: z.number().int().min(0).default(2),
  weeks: z.number().min(0).max(52).default(0.5),
});

export const platformRule = z.object({
  key,
  label: z.string(),
  description: z.string().default(""),
  amountMinor: minor,
  complexityPoints: z.number().int().min(0).default(0),
  weeks: z.number().min(0).max(52).default(0),
  flags: z.array(reviewFlagCode).default([]),
});

export const bandRule = z.object({
  key,
  label: z.string(),
  amountMinor: minor.default(0),
  complexityPoints: z.number().int().min(0).default(0),
});

export const multiplierBand = z.object({
  key,
  label: z.string(),
  multiplierBps: bps,
  /** Calendar compression this choice implies. */
  description: z.string().default(""),
});

export const pricingRulesSchema = z
  .object({
    currency: z.literal("ZAR").default("ZAR"),
    solutions: z.array(solutionRule).min(1),
    /** Additional solutions beyond the most expensive are charged at this share of their base. */
    additionalSolutionBps: bps.default(5000),
    featureGroups: z.array(featureGroupRule),
    features: z.array(featureRule),
    integrations: z.array(integrationRule),
    /** Surcharge on an integration whose vendor API availability is unknown / absent. */
    unknownApiSurchargeBps: bps.default(3000),
    platforms: z.array(platformRule).min(1),
    internalUserBands: z.array(bandRule).min(1),
    customerUserBands: z.array(bandRule).min(1),
    roleBands: z.array(bandRule).min(1),
    migrationLevels: z.array(bandRule.extend({ flags: z.array(reviewFlagCode).default([]) })).min(1),
    brandingReadiness: z.array(bandRule).min(1),
    urgency: z.array(multiplierBand).min(1),
    complexityTiers: z
      .array(z.object({ upToPoints: z.number().int().min(0), multiplierBps: bps, label: z.string() }))
      .min(1),
    range: z.object({
      lowBps: bps.default(9000),
      highBps: z.object({ high: bps, medium: bps, low: bps }),
    }),
    roundingStepMinor: minor.default(100_000),
    minimumProjectMinor: minor.default(0),
    maxAutoEstimateMinor: minor,
    maxIntegrationsBeforeReview: z.number().int().min(0).default(4),
    maxPlatformsBeforeReview: z.number().int().min(0).default(3),
    weeksPerComplexityPoint: z.number().min(0).max(4).default(0.25),
    budgetBands: z.array(
      z.object({ key, label: z.string(), minMinor: minor.nullable(), maxMinor: minor.nullable() }),
    ),
    launchTargets: z.array(z.object({ key, label: z.string(), weeks: z.number().int().nullable() })),
    discovery: z.object({
      /** Package slug of the purchasable discovery product (catalogue item with isDiscovery=true). */
      packageSlug: z.string().nullable().default(null),
      feeMinor: minor,
      /** Above this indicative total, paid discovery is recommended. */
      recommendAboveMinor: minor,
      description: z.string().default(""),
    }),
    deposit: z.object({ percentBps: bps }),
    milestoneSchedule: z
      .array(z.object({ key, label: z.string(), percentBps: bps, description: z.string().default("") }))
      .min(1),
    /** Route simple, well-understood scopes to a fixed package instead. */
    packageMappings: z
      .array(
        z.object({
          solutionKey: key,
          packageSlug: z.string(),
          maxTotalMinor: minor,
          maxFeatures: z.number().int().min(0).default(99),
        }),
      )
      .default([]),
    assumptions: z.array(z.string()).default([]),
    exclusions: z.array(z.string()).default([]),
    thirdPartyNotes: z.array(z.string()).default([]),
  })
  .superRefine((rules, ctx) => {
    const sum = rules.milestoneSchedule.reduce((a, m) => a + m.percentBps, 0);
    if (sum !== 10_000) {
      ctx.addIssue({ code: "custom", path: ["milestoneSchedule"], message: `milestone percentages must sum to 100% (got ${sum / 100}%)` });
    }
    const featureKeys = new Set(rules.features.map((f) => f.key));
    const groupKeys = new Set(rules.featureGroups.map((g) => g.key));
    const solutionKeys = new Set(rules.solutions.map((s) => s.key));
    rules.features.forEach((f, i) => {
      if (!groupKeys.has(f.groupKey)) ctx.addIssue({ code: "custom", path: ["features", i, "groupKey"], message: `unknown group ${f.groupKey}` });
      f.requires.forEach((r) => {
        if (!featureKeys.has(r)) ctx.addIssue({ code: "custom", path: ["features", i, "requires"], message: `unknown feature ${r}` });
      });
      f.solutions.forEach((s) => {
        if (!solutionKeys.has(s)) ctx.addIssue({ code: "custom", path: ["features", i, "solutions"], message: `unknown solution ${s}` });
      });
    });
    for (const list of ["features", "integrations", "platforms", "solutions"] as const) {
      const seen = new Set<string>();
      (rules[list] as { key: string }[]).forEach((item, i) => {
        if (seen.has(item.key)) ctx.addIssue({ code: "custom", path: [list, i, "key"], message: `duplicate key ${item.key}` });
        seen.add(item.key);
      });
    }
    const tiers = [...rules.complexityTiers].map((t) => t.upToPoints);
    if (tiers.some((t, i) => i > 0 && t <= tiers[i - 1])) {
      ctx.addIssue({ code: "custom", path: ["complexityTiers"], message: "complexity tiers must be in ascending order" });
    }
  });

export type PricingRules = z.infer<typeof pricingRulesSchema>;
export type PricingRulesInput = z.input<typeof pricingRulesSchema>;
