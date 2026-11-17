import { applyBps, allocateByBps, computeTax, roundToStep, sumMinor, NO_TAX, type TaxConfig } from "../money";
import type { ConfiguratorAnswers } from "../configurator/answers";
import type { PricingRules, ReviewFlagCode } from "./rules";

/**
 * Deterministic indicative estimate engine.
 *
 *   estimate_total = base_solution_price
 *                  + selected_feature_adjustments
 *                  + integration_complexity_adjustments
 *                  + platform_adjustments
 *                  + migration_adjustment (+ users/roles/branding bands)
 *                  + complexity_adjustment
 *                  + urgency_adjustment
 *   (discovery fee and tax are reported separately)
 *
 * Pure function: same answers + same rules => same output. No I/O, no AI.
 */

export type Confidence = "high" | "medium" | "low";
export type Recommendation = "intro_call" | "paid_discovery" | "package";

export interface EstimateLineItem {
  key: string;
  category:
    | "solution"
    | "feature"
    | "integration"
    | "platform"
    | "users"
    | "roles"
    | "migration"
    | "branding"
    | "complexity"
    | "urgency"
    | "minimum";
  label: string;
  amountMinor: number;
}

export interface EstimateFlag {
  code: ReviewFlagCode;
  message: string;
}

export interface EstimateMilestone {
  key: string;
  label: string;
  description: string;
  percentBps: number;
  amountMinor: number;
}

export interface EstimateResult {
  currency: "ZAR";
  /** False when nothing can be priced (e.g. only "Not sure yet" selected). */
  priced: boolean;
  lineItems: EstimateLineItem[];
  subtotalMinor: number;
  complexityPoints: number;
  complexityTier: string;
  totalMinor: number;
  lowMinor: number;
  highMinor: number;
  taxMinor: number;
  taxLabel: string | null;
  discoveryFeeMinor: number;
  depositMinor: number;
  depositPercentBps: number;
  milestones: EstimateMilestone[];
  timeline: { minWeeks: number; maxWeeks: number };
  confidence: Confidence;
  flags: EstimateFlag[];
  requiresManualReview: boolean;
  recommendation: Recommendation;
  recommendedPackageSlug: string | null;
  recommendedSolution: string;
  suggestedFeatures: string[];
  assumptions: string[];
  exclusions: string[];
  thirdPartyNotes: string[];
  statement: string;
}

export class AnswersRulesMismatchError extends Error {
  constructor(public readonly issues: { path: string; message: string }[]) {
    super(`Answers do not match the active pricing rules: ${issues.map((i) => `${i.path}: ${i.message}`).join("; ")}`);
    this.name = "AnswersRulesMismatchError";
  }
}

/** Ensure every key in the answers exists in the rules and dependencies are satisfied. */
export function validateAnswersAgainstRules(answers: ConfiguratorAnswers, rules: PricingRules): void {
  const issues: { path: string; message: string }[] = [];
  const has = <T extends { key: string }>(list: T[], k: string) => list.some((x) => x.key === k);

  answers.solution.types.forEach((t, i) => {
    if (!has(rules.solutions, t)) issues.push({ path: `solution.types.${i}`, message: `unknown solution "${t}"` });
  });
  answers.capabilities.features.forEach((f, i) => {
    if (!has(rules.features, f)) issues.push({ path: `capabilities.features.${i}`, message: `unknown feature "${f}"` });
  });
  const selected = new Set(answers.capabilities.features);
  for (const f of rules.features) {
    if (!selected.has(f.key)) continue;
    for (const req of f.requires) {
      if (!selected.has(req)) {
        const reqLabel = rules.features.find((x) => x.key === req)?.label ?? req;
        issues.push({ path: "capabilities.features", message: `"${f.label}" requires "${reqLabel}"` });
      }
    }
  }
  answers.integrations.items.forEach((it, i) => {
    if (!has(rules.integrations, it.key)) issues.push({ path: `integrations.items.${i}`, message: `unknown integration "${it.key}"` });
  });
  const dupInt = answers.integrations.items.map((i) => i.key);
  if (new Set(dupInt).size !== dupInt.length) issues.push({ path: "integrations.items", message: "duplicate integration" });
  answers.platforms.platforms.forEach((p, i) => {
    if (!has(rules.platforms, p)) issues.push({ path: `platforms.platforms.${i}`, message: `unknown platform "${p}"` });
  });
  const bandChecks: [string, string, { key: string }[]][] = [
    ["users.internalBand", answers.users.internalBand, rules.internalUserBands],
    ["users.customerBand", answers.users.customerBand, rules.customerUserBands],
    ["users.roleBand", answers.users.roleBand, rules.roleBands],
    ["migration.level", answers.migration.level, rules.migrationLevels],
    ["platforms.branding", answers.platforms.branding, rules.brandingReadiness],
    ["budget.budgetBand", answers.budget.budgetBand, rules.budgetBands],
    ["budget.launchTarget", answers.budget.launchTarget, rules.launchTargets],
    ["budget.urgency", answers.budget.urgency, rules.urgency],
  ];
  for (const [path, value, list] of bandChecks) {
    if (!has(list, value)) issues.push({ path, message: `unknown option "${value}"` });
  }
  if (issues.length) throw new AnswersRulesMismatchError(issues);
}

function pushFlag(flags: EstimateFlag[], code: ReviewFlagCode, message: string) {
  if (!flags.some((f) => f.code === code)) flags.push({ code, message });
}

const FLAG_MESSAGES: Record<ReviewFlagCode, string> = {
  unclear_solution: "The core solution is not yet clear — a short conversation will pin it down.",
  contradictory_requirements: "Some selected capabilities don't match the chosen solution type.",
  many_platforms: "Several delivery platforms were selected; scope needs to be confirmed.",
  many_integrations: "An unusually high number of integrations was selected.",
  native_mobile: "Native mobile apps carry app-store, device and release-management scope.",
  offline_mode: "Offline operation and data sync need careful design.",
  sensitive_data: "Sensitive personal or financial data requires a security and POPIA review.",
  regulated_workflow: "Regulated workflows need compliance requirements confirmed.",
  large_migration: "A large data migration needs a source-data assessment.",
  unknown_source_system: "Ownership/access to the existing system is uncertain.",
  budget_below_estimate: "The stated budget is below the indicative range.",
  timeline_conflict: "The target launch date is earlier than the indicative delivery window.",
  above_auto_threshold: "The estimate exceeds the threshold for automated estimates.",
  low_confidence: "There is not enough detail for a confident estimate.",
  unpriced_items: "Some items can only be priced after discovery.",
};

export function estimateProject(
  answers: ConfiguratorAnswers,
  rules: PricingRules,
  opts: { tax?: TaxConfig } = {},
): EstimateResult {
  validateAnswersAgainstRules(answers, rules);
  const tax = opts.tax ?? NO_TAX;
  const flags: EstimateFlag[] = [];
  const items: EstimateLineItem[] = [];
  let points = 0;
  let minWeeks = 0;
  let maxWeeks = 0;
  let confidenceScore = 0; // 0 = high; each concern adds 1; >=3 low, >=1 medium

  // --- solutions ---------------------------------------------------------
  const solutions = answers.solution.types
    .map((k) => rules.solutions.find((s) => s.key === k)!)
    .filter(Boolean);
  const priced = solutions.filter((s) => !s.unpriced);
  if (priced.length === 0) {
    pushFlag(flags, "unclear_solution", FLAG_MESSAGES.unclear_solution);
    confidenceScore += 3;
  }
  if (solutions.some((s) => s.unpriced) && priced.length > 0) {
    pushFlag(flags, "unclear_solution", FLAG_MESSAGES.unclear_solution);
    confidenceScore += 1;
  }
  const sortedSolutions = [...priced].sort((a, b) => b.baseMinor - a.baseMinor);
  sortedSolutions.forEach((s, idx) => {
    const amount = idx === 0 ? s.baseMinor : applyBps(s.baseMinor, rules.additionalSolutionBps);
    items.push({ key: s.key, category: "solution", label: idx === 0 ? s.label : `${s.label} (combined)`, amountMinor: amount });
    points += s.complexityPoints;
    if (idx === 0) {
      minWeeks = s.minWeeks;
      maxWeeks = s.maxWeeks;
    } else {
      minWeeks += Math.ceil(s.minWeeks * (rules.additionalSolutionBps / 10_000));
      maxWeeks += Math.ceil(s.maxWeeks * (rules.additionalSolutionBps / 10_000));
    }
  });

  // --- features ------------------------------------------------------------
  const selectedSolutionKeys = new Set(priced.map((s) => s.key));
  let featureWeeks = 0;
  for (const fk of answers.capabilities.features) {
    const f = rules.features.find((x) => x.key === fk)!;
    items.push({ key: f.key, category: "feature", label: f.label, amountMinor: f.amountMinor });
    points += f.complexityPoints;
    featureWeeks += f.weeks;
    f.flags.forEach((code) => pushFlag(flags, code, FLAG_MESSAGES[code]));
    if (f.solutions.length > 0 && priced.length > 0 && !f.solutions.some((s) => selectedSolutionKeys.has(s))) {
      pushFlag(flags, "contradictory_requirements", FLAG_MESSAGES.contradictory_requirements);
      confidenceScore += 1;
    }
  }

  // --- integrations ---------------------------------------------------------
  let integrationWeeks = 0;
  for (const it of answers.integrations.items) {
    const rule = rules.integrations.find((x) => x.key === it.key)!;
    let amount = rule.amountMinor;
    let label = rule.label + (it.vendor ? ` — ${it.vendor}` : "");
    if (it.apiAvailable !== "yes") {
      amount += applyBps(rule.amountMinor, rules.unknownApiSurchargeBps);
      label += it.apiAvailable === "no" ? " (no public API)" : " (API to be confirmed)";
      confidenceScore += it.apiAvailable === "no" ? 1 : 0.5;
    }
    items.push({ key: it.key, category: "integration", label, amountMinor: amount });
    points += rule.complexityPoints;
    integrationWeeks += rule.weeks;
  }
  if (answers.integrations.other.trim().length > 0) {
    pushFlag(flags, "unpriced_items", FLAG_MESSAGES.unpriced_items);
    confidenceScore += 0.5;
  }
  if (answers.integrations.items.length > rules.maxIntegrationsBeforeReview) {
    pushFlag(flags, "many_integrations", FLAG_MESSAGES.many_integrations);
    confidenceScore += 1;
  }

  // --- platforms ------------------------------------------------------------
  let platformWeeks = 0;
  for (const pk of answers.platforms.platforms) {
    const p = rules.platforms.find((x) => x.key === pk)!;
    if (p.amountMinor > 0) items.push({ key: p.key, category: "platform", label: p.label, amountMinor: p.amountMinor });
    points += p.complexityPoints;
    platformWeeks += p.weeks;
    p.flags.forEach((code) => pushFlag(flags, code, FLAG_MESSAGES[code]));
  }
  if (answers.platforms.platforms.length > rules.maxPlatformsBeforeReview) {
    pushFlag(flags, "many_platforms", FLAG_MESSAGES.many_platforms);
  }

  // --- users, roles, branding, migration bands ---------------------------
  const band = (
    list: { key: string; label: string; amountMinor: number; complexityPoints: number }[],
    k: string,
    category: EstimateLineItem["category"],
    prefix: string,
  ) => {
    const b = list.find((x) => x.key === k)!;
    if (b.amountMinor > 0) items.push({ key: b.key, category, label: `${prefix}: ${b.label}`, amountMinor: b.amountMinor });
    points += b.complexityPoints;
    return b;
  };
  band(rules.internalUserBands, answers.users.internalBand, "users", "Internal users");
  band(rules.customerUserBands, answers.users.customerBand, "users", "Customer users");
  band(rules.roleBands, answers.users.roleBand, "roles", "User roles");
  band(rules.brandingReadiness, answers.platforms.branding, "branding", "Design & branding");
  const migration = rules.migrationLevels.find((m) => m.key === answers.migration.level)!;
  if (migration.amountMinor > 0) {
    items.push({ key: migration.key, category: "migration", label: `Data migration: ${migration.label}`, amountMinor: migration.amountMinor });
  }
  points += migration.complexityPoints;
  migration.flags.forEach((code) => pushFlag(flags, code, FLAG_MESSAGES[code]));
  if (migration.amountMinor > 0 && !answers.migration.sourceOwnershipKnown) {
    pushFlag(flags, "unknown_source_system", FLAG_MESSAGES.unknown_source_system);
    confidenceScore += 1;
  }

  // --- complexity & urgency --------------------------------------------------
  const subtotal = sumMinor(items.map((i) => i.amountMinor));
  const tier =
    rules.complexityTiers.find((t) => points <= t.upToPoints) ?? rules.complexityTiers[rules.complexityTiers.length - 1];
  const complexityAdj = applyBps(subtotal, tier.multiplierBps);
  if (complexityAdj > 0) {
    items.push({ key: "complexity", category: "complexity", label: `Complexity adjustment (${tier.label})`, amountMinor: complexityAdj });
  }
  const urgency = rules.urgency.find((u) => u.key === answers.budget.urgency)!;
  const urgencyAdj = applyBps(subtotal + complexityAdj, urgency.multiplierBps);
  if (urgencyAdj > 0) {
    items.push({ key: urgency.key, category: "urgency", label: `Delivery urgency (${urgency.label})`, amountMinor: urgencyAdj });
  }

  let rawTotal = subtotal + complexityAdj + urgencyAdj;
  if (priced.length > 0 && rawTotal < rules.minimumProjectMinor) {
    items.push({ key: "minimum", category: "minimum", label: "Minimum engagement", amountMinor: rules.minimumProjectMinor - rawTotal });
    rawTotal = rules.minimumProjectMinor;
  }
  const total = priced.length > 0 ? roundToStep(rawTotal, rules.roundingStepMinor) : 0;

  // --- timeline ---------------------------------------------------------------
  const extraWeeks = featureWeeks + integrationWeeks + platformWeeks + points * rules.weeksPerComplexityPoint;
  minWeeks = Math.max(1, Math.round(minWeeks + extraWeeks * 0.6));
  maxWeeks = Math.max(minWeeks, Math.round(maxWeeks + extraWeeks));
  if (urgency.multiplierBps > 0) {
    // Paying for urgency compresses the calendar but not below ~70 % of the standard window.
    minWeeks = Math.max(1, Math.round(minWeeks * 0.8));
    maxWeeks = Math.max(minWeeks, Math.round(maxWeeks * 0.8));
  }

  // --- confidence ----------------------------------------------------------------
  if (answers.problem.description.trim().length < 80) confidenceScore += 0.5;
  if (answers.solution.types.length > 2) confidenceScore += 0.5;
  const confidence: Confidence = confidenceScore >= 2.5 ? "low" : confidenceScore >= 1 ? "medium" : "high";

  // --- range ----------------------------------------------------------------------
  const low = priced.length > 0 ? roundToStep(applyBps(total, rules.range.lowBps), rules.roundingStepMinor) : 0;
  const high = priced.length > 0 ? roundToStep(applyBps(total, rules.range.highBps[confidence]), rules.roundingStepMinor) : 0;

  // --- review triggers ---------------------------------------------------------------
  const budget = rules.budgetBands.find((b) => b.key === answers.budget.budgetBand)!;
  if (priced.length > 0 && budget.maxMinor !== null && budget.maxMinor < low) {
    pushFlag(flags, "budget_below_estimate", FLAG_MESSAGES.budget_below_estimate);
  }
  const launch = rules.launchTargets.find((l) => l.key === answers.budget.launchTarget)!;
  if (priced.length > 0 && launch.weeks !== null && launch.weeks < minWeeks) {
    pushFlag(flags, "timeline_conflict", FLAG_MESSAGES.timeline_conflict);
  }
  if (total > rules.maxAutoEstimateMinor) pushFlag(flags, "above_auto_threshold", FLAG_MESSAGES.above_auto_threshold);
  if (confidence === "low") pushFlag(flags, "low_confidence", FLAG_MESSAGES.low_confidence);
  const requiresManualReview = flags.length > 0;

  // --- tax, deposit, milestones --------------------------------------------------------
  const taxed = computeTax(total, tax);
  const contractValue = taxed.totalMinor;
  const deposit = applyBps(contractValue, rules.deposit.percentBps);
  const allocations = allocateByBps(
    contractValue,
    rules.milestoneSchedule.map((m) => m.percentBps),
  );
  const milestones: EstimateMilestone[] = rules.milestoneSchedule.map((m, i) => ({
    key: m.key,
    label: m.label,
    description: m.description,
    percentBps: m.percentBps,
    amountMinor: allocations[i],
  }));

  // --- recommendation ---------------------------------------------------------------------
  let recommendation: Recommendation = "intro_call";
  let recommendedPackageSlug: string | null = null;
  if (priced.length === 1 && !requiresManualReview) {
    const mapping = rules.packageMappings.find(
      (m) =>
        m.solutionKey === priced[0].key &&
        total <= m.maxTotalMinor &&
        answers.capabilities.features.length <= m.maxFeatures,
    );
    if (mapping) {
      recommendation = "package";
      recommendedPackageSlug = mapping.packageSlug;
    }
  }
  if (recommendation !== "package") {
    const discoveryAvailable = rules.discovery.feeMinor > 0 && rules.discovery.packageSlug !== null;
    if (discoveryAvailable && (requiresManualReview || total >= rules.discovery.recommendAboveMinor)) {
      recommendation = "paid_discovery";
    }
  }

  const suggestedFeatures = rules.features
    .filter(
      (f) =>
        !answers.capabilities.features.includes(f.key) &&
        f.requires.every((r) => answers.capabilities.features.includes(r)) &&
        (f.solutions.length === 0 || f.solutions.some((s) => selectedSolutionKeys.has(s))) &&
        f.flags.length === 0,
    )
    .slice(0, 4)
    .map((f) => f.key);

  const recommendedSolution =
    priced.length === 0
      ? "To be defined in a discovery conversation"
      : sortedSolutions.map((s) => s.label).join(" + ");

  return {
    currency: "ZAR",
    priced: priced.length > 0,
    lineItems: items,
    subtotalMinor: subtotal,
    complexityPoints: points,
    complexityTier: tier.label,
    totalMinor: total,
    lowMinor: low,
    highMinor: high,
    taxMinor: taxed.taxMinor,
    taxLabel: tax.enabled ? tax.label : null,
    discoveryFeeMinor: recommendation === "paid_discovery" ? rules.discovery.feeMinor : 0,
    depositMinor: deposit,
    depositPercentBps: rules.deposit.percentBps,
    milestones,
    timeline: { minWeeks, maxWeeks },
    confidence,
    flags,
    requiresManualReview,
    recommendation,
    recommendedPackageSlug,
    recommendedSolution,
    suggestedFeatures,
    assumptions: rules.assumptions,
    exclusions: rules.exclusions,
    thirdPartyNotes: rules.thirdPartyNotes,
    statement:
      "This is an indicative, non-binding estimate generated from your answers and our published pricing rules. " +
      "It is subject to discovery and a written proposal, does not reserve capacity and does not guarantee a delivery date.",
  };
}
