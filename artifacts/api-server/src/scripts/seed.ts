/**
 * Idempotent seed.
 *   pnpm --filter @workspace/api-server run seed        → reference content; packages + pricing as DRAFTS
 *   pnpm --filter @workspace/api-server run seed:demo   → also publishes packages and activates the DEMO pricing
 *                                                         version, and enables EFT (+ PayFast sandbox if configured)
 * Demo mode is for local development, staging and automated tests only.
 */
import { eq, sql } from "drizzle-orm";
import { faqs, packageOptions, packageVariants, packages, portfolioProjects, pricingRuleVersions, serviceCategories, type Database } from "@workspace/db";
import { DEMO_PRICING_RULES, pricingRulesSchema } from "@workspace/domain";
import { loadConfig } from "../config/env";
import { createContext, type AppContext } from "../context";
import { SETTINGS_DEFAULTS } from "../services/settings";
import { FAQS, PACKAGES, PORTFOLIO, SERVICES } from "./seed-data";

export async function seed(app: AppContext, opts: { demo: boolean }) {
  const db: Database = app.db;
  await db.transaction(async (tx) => {
    for (const s of SERVICES) await tx.insert(serviceCategories).values(s).onConflictDoNothing({ target: serviceCategories.slug });
    for (const p of PORTFOLIO) {
      await tx
        .insert(portfolioProjects)
        .values({ ...p, publicationStatus: "published", publishedAt: new Date() })
        .onConflictDoNothing({ target: portfolioProjects.slug });
    }
    const [{ n: faqCount }] = await tx.select({ n: sql<number>`count(*)` }).from(faqs);
    if (Number(faqCount) === 0) await tx.insert(faqs).values(FAQS);

    for (const p of PACKAGES) {
      const { variants = [], options = [], ...pkg } = p;
      const [row] = await tx
        .insert(packages)
        .values({ ...pkg, status: opts.demo ? "published" : "draft" })
        .onConflictDoNothing({ target: packages.slug })
        .returning({ id: packages.id });
      if (!row) {
        if (opts.demo) await tx.update(packages).set({ status: "published" }).where(eq(packages.slug, p.slug));
        continue;
      }
      if (variants.length) await tx.insert(packageVariants).values(variants.map((v) => ({ ...v, packageId: row.id })));
      if (options.length) {
        await tx.insert(packageOptions).values(
          options.map((o) => ({ ...o, packageId: row.id, unitLabel: o.unitLabel ?? null, minQty: o.minQty ?? 1, maxQty: o.maxQty ?? 1, rules: o.rules ?? { requires: [], excludes: [], variants: [] } })),
        );
      }
    }

    const existing = await tx.select({ id: pricingRuleVersions.id, status: pricingRuleVersions.status }).from(pricingRuleVersions);
    if (existing.length === 0) {
      await tx.insert(pricingRuleVersions).values({
        version: 1,
        name: "Demonstration rules (not an approved rate card)",
        status: opts.demo ? "active" : "draft",
        rules: pricingRulesSchema.parse(DEMO_PRICING_RULES),
        isDemo: true,
        notes: "Placeholder coefficients so the configurator can be exercised end-to-end. Replace with an approved rate card before launch.",
        effectiveFrom: opts.demo ? new Date() : null,
        approvedAt: opts.demo ? new Date() : null,
      });
    } else if (opts.demo && !existing.some((e) => e.status === "active")) {
      await tx.update(pricingRuleVersions).set({ status: "active", effectiveFrom: new Date() }).where(eq(pricingRuleVersions.version, 1));
    }

    if (opts.demo) {
      const providers: ("payfast" | "yoco" | "eft")[] = ["eft"];
      if (app.payments.get("payfast")?.configured()) providers.unshift("payfast");
      if (app.payments.get("yoco")?.configured()) providers.unshift("yoco");
      const commerce = await app.settings.get("commerce", tx);
      await app.settings.set(
        "commerce",
        {
          ...commerce,
          enabledProviders: providers,
          defaultProvider: providers[0],
          eft: commerce.eft.accountNumber ? commerce.eft : { bankName: "DEMO BANK — replace in settings", accountName: "Operandis (demo)", accountNumber: "0000000000", branchCode: "000000", accountType: "Business cheque" },
        },
        null,
        tx,
      );
    }
  });
  void SETTINGS_DEFAULTS;
}

const isMain = process.argv[1] && /seed\.(ts|mjs|js)$/.test(process.argv[1]);
if (isMain) {
  const demo = process.argv.includes("--demo");
  const app = createContext(loadConfig());
  seed(app, { demo })
    .then(() => console.log(`seed complete${demo ? " (demo mode: packages published, demo pricing active)" : " (packages and pricing are drafts)"}`))
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => app.dbHandle.close());
}
