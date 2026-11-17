import { describe, expect, it } from "vitest";
import { estimateProject, AnswersRulesMismatchError } from "../src/pricing/engine";
import { pricingRulesSchema, type PricingRules } from "../src/pricing/rules";
import { DEMO_PRICING_RULES } from "../src/pricing/demo-rules";
import { configuratorSubmissionAnswers, type ConfiguratorAnswers } from "../src/configurator/answers";
import { quotePackage, SelectionError, type PackageSnapshot } from "../src/catalogue/package-pricing";

const rules: PricingRules = pricingRulesSchema.parse(DEMO_PRICING_RULES);

function answers(overrides: Partial<{ [K in keyof ConfiguratorAnswers]: Partial<ConfiguratorAnswers[K]> }> = {}): ConfiguratorAnswers {
  const base = {
    context: { clientType: "company", name: "Thandi Mokoena", email: "thandi@example.co.za", company: "Acme", industry: "Retail", country: "ZA" },
    problem: { description: "Our team tracks every order in three spreadsheets and WhatsApp groups, and we lose orders every week." },
    solution: { types: ["website"] },
    users: { internalBand: "1_10", customerBand: "under_100", roleBand: "one" },
    capabilities: { features: [] },
    integrations: { items: [] },
    platforms: { platforms: ["web"], branding: "ready" },
    migration: { level: "none" },
    budget: { budgetBand: "not_sure", launchTarget: "flexible", urgency: "standard" },
    review: { consentProcessing: true },
  } as Record<string, Record<string, unknown>>;
  for (const [k, v] of Object.entries(overrides)) base[k] = { ...base[k], ...(v as object) };
  return configuratorSubmissionAnswers.parse(base);
}

describe("pricing rules schema", () => {
  it("accepts the demo rule set", () => {
    expect(rules.solutions.length).toBeGreaterThan(3);
  });
  it("rejects milestone schedules that do not sum to 100%", () => {
    const bad = { ...DEMO_PRICING_RULES, milestoneSchedule: [{ key: "a", label: "A", percentBps: 4000 }] };
    expect(pricingRulesSchema.safeParse(bad).success).toBe(false);
  });
  it("rejects unknown feature dependencies", () => {
    const bad = { ...DEMO_PRICING_RULES, features: [{ key: "x", groupKey: "accounts", label: "X", amountMinor: 1, requires: ["nope"] }] };
    expect(pricingRulesSchema.safeParse(bad).success).toBe(false);
  });
});

describe("estimate engine", () => {
  it("is deterministic", () => {
    const a = answers({ solution: { types: ["internal_system"] }, capabilities: { features: ["user_accounts", "reporting"] } });
    expect(estimateProject(a, rules)).toEqual(estimateProject(a, rules));
  });

  it("prices a simple website and routes it to the package", () => {
    const r = estimateProject(answers(), rules);
    expect(r.priced).toBe(true);
    expect(r.totalMinor).toBe(2_500_000);
    expect(r.lowMinor).toBeLessThanOrEqual(r.totalMinor);
    expect(r.highMinor).toBeGreaterThanOrEqual(r.totalMinor);
    expect(r.requiresManualReview).toBe(false);
    expect(r.recommendation).toBe("package");
    expect(r.recommendedPackageSlug).toBe("business-website");
    expect(r.milestones.reduce((s, m) => s + m.amountMinor, 0)).toBe(r.totalMinor);
    expect(r.depositMinor).toBe(1_250_000);
  });

  it("sums line items, complexity and urgency", () => {
    const r = estimateProject(
      answers({
        solution: { types: ["internal_system"] },
        capabilities: { features: ["user_accounts", "roles_permissions", "workflow_approvals", "reporting"] },
        integrations: { items: [{ key: "accounting", vendor: "Xero", apiAvailable: "yes" }] },
        budget: { urgency: "priority" },
      }),
      rules,
    );
    const base = 8_500_000 + 1_200_000 + 1_500_000 + 2_500_000 + 2_200_000 + 1_800_000;
    expect(r.subtotalMinor).toBe(base);
    const complexity = r.lineItems.find((l) => l.category === "complexity")?.amountMinor ?? 0;
    const urgency = r.lineItems.find((l) => l.category === "urgency")!.amountMinor;
    expect(urgency).toBe(Math.round((base + complexity) * 0.15));
    expect(r.totalMinor % 100_000).toBe(0);
  });

  it("charges combined solutions at the configured share", () => {
    const r = estimateProject(answers({ solution: { types: ["website", "ecommerce"] } }), rules);
    expect(r.lineItems.filter((l) => l.category === "solution").map((l) => l.amountMinor)).toEqual([5_500_000, 1_250_000]);
  });

  it("flags native mobile, sensitive data and offline mode for manual review", () => {
    const r = estimateProject(
      answers({
        solution: { types: ["mobile_app"] },
        capabilities: { features: ["offline_mode", "sensitive_data"] },
        platforms: { platforms: ["ios", "android"] },
      }),
      rules,
    );
    const codes = r.flags.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["native_mobile", "offline_mode", "sensitive_data"]));
    expect(r.requiresManualReview).toBe(true);
    expect(r.recommendation).toBe("paid_discovery");
    expect(r.discoveryFeeMinor).toBe(750_000);
  });

  it("treats 'not sure' as unpriced and low confidence", () => {
    const r = estimateProject(answers({ solution: { types: ["unsure"] } }), rules);
    expect(r.priced).toBe(false);
    expect(r.totalMinor).toBe(0);
    expect(r.confidence).toBe("low");
    expect(r.flags.map((f) => f.code)).toContain("unclear_solution");
  });

  it("flags budgets below the indicative range and timeline conflicts", () => {
    const r = estimateProject(
      answers({ solution: { types: ["saas"] }, budget: { budgetBand: "under_50k", launchTarget: "asap" } }),
      rules,
    );
    const codes = r.flags.map((f) => f.code);
    expect(codes).toContain("budget_below_estimate");
    expect(codes).toContain("timeline_conflict");
  });

  it("flags features that contradict the selected solution", () => {
    const r = estimateProject(answers({ capabilities: { features: ["user_accounts", "roles_permissions", "multi_tenant"] } }), rules);
    expect(r.flags.map((f) => f.code)).toContain("contradictory_requirements");
  });

  it("enforces feature dependencies", () => {
    expect(() => estimateProject(answers({ capabilities: { features: ["subscriptions"] } }), rules)).toThrow(AnswersRulesMismatchError);
  });

  it("rejects unknown keys", () => {
    expect(() => estimateProject(answers({ solution: { types: ["spaceship"] } }), rules)).toThrow(AnswersRulesMismatchError);
  });

  it("surcharges integrations with unknown APIs and lowers confidence", () => {
    const known = estimateProject(answers({ integrations: { items: [{ key: "crm", vendor: "HubSpot", apiAvailable: "yes" }] } }), rules);
    const unknown = estimateProject(answers({ integrations: { items: [{ key: "crm", vendor: "Custom", apiAvailable: "no" }] } }), rules);
    expect(unknown.subtotalMinor).toBeGreaterThan(known.subtotalMinor);
  });

  it("adds tax when configured", () => {
    const r = estimateProject(answers(), rules, { tax: { enabled: true, rateBps: 1500, label: "VAT", pricesIncludeTax: false } });
    expect(r.taxMinor).toBe(375_000);
    expect(r.milestones.reduce((s, m) => s + m.amountMinor, 0)).toBe(r.totalMinor + r.taxMinor);
  });
});

describe("package pricing", () => {
  const pkg: PackageSnapshot = {
    id: "p1",
    slug: "ecommerce-store",
    name: "E-commerce store",
    version: 1,
    status: "published",
    pricingMode: "fixed",
    priceMinor: 0,
    currency: "ZAR",
    deposit: { type: "percent", percentBps: 5000 },
    variants: [
      { key: "starter", name: "Starter", priceMinor: 4_500_000, active: true },
      { key: "growth", name: "Growth", priceMinor: 7_500_000, active: true },
    ],
    options: [
      { key: "extra_pages", label: "Extra pages", pricingType: "per_unit", amountMinor: 150_000, unitLabel: "page", minQty: 1, maxQty: 20, active: true, requires: [], excludes: [], variants: [] },
      { key: "payfast", label: "PayFast setup", pricingType: "fixed", amountMinor: 300_000, minQty: 1, maxQty: 1, active: true, requires: [], excludes: ["yoco"], variants: [] },
      { key: "yoco", label: "Yoco setup", pricingType: "fixed", amountMinor: 300_000, minQty: 1, maxQty: 1, active: true, requires: [], excludes: ["payfast"], variants: [] },
      { key: "subscriptions", label: "Subscriptions", pricingType: "fixed", amountMinor: 900_000, minQty: 1, maxQty: 1, active: true, requires: ["payfast"], excludes: [], variants: ["growth"] },
      { key: "erp", label: "ERP sync", pricingType: "manual_review", amountMinor: 0, minQty: 1, maxQty: 1, active: true, requires: [], excludes: [], variants: [] },
    ],
  };

  it("calculates totals, deposit and balance", () => {
    const q = quotePackage(pkg, { variantKey: "growth", options: [{ key: "extra_pages", quantity: 3 }, { key: "payfast", quantity: 1 }] });
    expect(q.totalMinor).toBe(7_500_000 + 450_000 + 300_000);
    expect(q.depositMinor).toBe(4_125_000);
    expect(q.balanceMinor).toBe(q.totalMinor - q.depositMinor);
    expect(q.purchasable).toBe(true);
  });

  it("enforces compatibility rules", () => {
    expect(() => quotePackage(pkg, { variantKey: "growth", options: [{ key: "payfast", quantity: 1 }, { key: "yoco", quantity: 1 }] })).toThrow(SelectionError);
    expect(() => quotePackage(pkg, { variantKey: "growth", options: [{ key: "subscriptions", quantity: 1 }] })).toThrow(/requires/);
    expect(() => quotePackage(pkg, { variantKey: "starter", options: [{ key: "payfast", quantity: 1 }, { key: "subscriptions", quantity: 1 }] })).toThrow(/tier/);
    expect(() => quotePackage(pkg, { variantKey: "growth", options: [{ key: "extra_pages", quantity: 50 }] })).toThrow(/Quantity/);
    expect(() => quotePackage(pkg, { options: [] })).toThrow(/tier/);
  });

  it("routes manual-review add-ons to a quote", () => {
    const q = quotePackage(pkg, { variantKey: "starter", options: [{ key: "erp", quantity: 1 }] });
    expect(q.purchasable).toBe(false);
    expect(q.requiresQuoteReasons.length).toBe(1);
  });

  it("refuses unpublished packages", () => {
    expect(() => quotePackage({ ...pkg, status: "paused" }, { variantKey: "starter", options: [] })).toThrow(/not currently available/);
  });
});
