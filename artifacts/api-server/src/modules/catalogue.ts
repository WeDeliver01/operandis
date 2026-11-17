import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { faqs, leadActivities, orders, packageOptions, packageVariants, packages, type DbOrTx } from "@workspace/db";
import { quotePackage, SelectionError, type PackageSnapshot } from "@workspace/domain";
import {
  optionUpsertBody,
  packageDetailSchema,
  packageEnquiryBody,
  packageQuoteSchema,
  packageSelectionSchema,
  packageStatusBody,
  packageSummarySchema,
  packageUpsertBody,
  variantUpsertBody,
  okSchema,
} from "@workspace/api-zod";
import { defineRoute, type RouteDef } from "../lib/route";
import { AppError, conflict, notFound } from "../lib/errors";
import { isUniqueViolation } from "../lib/db-helpers";
import { limits } from "../middleware/rate-limit";
import { audit } from "../services/audit";
import { captureLead } from "../services/leads";
import type { AppContext } from "../context";

type PackageRow = typeof packages.$inferSelect;

const ACTIVE_ORDER_STATUSES = ["confirmed", "in_progress"] as const;

export async function loadPackage(tx: DbOrTx, where: { id?: string; slug?: string }) {
  const [pkg] = await tx
    .select()
    .from(packages)
    .where(where.id ? eq(packages.id, where.id) : eq(packages.slug, where.slug!));
  if (!pkg) return null;
  const [variants, options] = await Promise.all([
    tx.select().from(packageVariants).where(eq(packageVariants.packageId, pkg.id)).orderBy(asc(packageVariants.displayOrder)),
    tx.select().from(packageOptions).where(eq(packageOptions.packageId, pkg.id)).orderBy(asc(packageOptions.displayOrder)),
  ]);
  return { pkg, variants, options };
}

export function toSnapshot(loaded: NonNullable<Awaited<ReturnType<typeof loadPackage>>>): PackageSnapshot {
  const { pkg, variants, options } = loaded;
  return {
    id: pkg.id,
    slug: pkg.slug,
    name: pkg.name,
    version: pkg.version,
    status: pkg.status,
    pricingMode: pkg.pricingMode,
    priceMinor: pkg.priceMinor,
    currency: "ZAR",
    deposit: pkg.deposit,
    variants: variants.map((v) => ({ key: v.key, name: v.name, priceMinor: v.priceMinor, active: v.active })),
    options: options.map((o) => ({
      key: o.key,
      label: o.label,
      pricingType: o.pricingType,
      amountMinor: o.amountMinor,
      unitLabel: o.unitLabel,
      minQty: o.minQty,
      maxQty: o.maxQty,
      active: o.active,
      requires: o.rules.requires,
      excludes: o.rules.excludes,
      variants: o.rules.variants,
    })),
  };
}

export async function activeOrderCount(tx: DbOrTx, packageId: string): Promise<number> {
  const [r] = await tx
    .select({ n: count() })
    .from(orders)
    .where(and(eq(orders.packageId, packageId), inArray(orders.status, [...ACTIVE_ORDER_STATUSES])));
  return Number(r?.n ?? 0);
}

function fromPrice(pkg: PackageRow, variants: (typeof packageVariants.$inferSelect)[]) {
  const active = variants.filter((v) => v.active);
  return active.length ? Math.min(...active.map((v) => v.priceMinor)) : pkg.priceMinor;
}

async function toSummary(tx: DbOrTx, pkg: PackageRow, variants: (typeof packageVariants.$inferSelect)[]) {
  const soldOut = pkg.capacityLimit !== null && (await activeOrderCount(tx, pkg.id)) >= pkg.capacityLimit;
  return {
    id: pkg.id,
    slug: pkg.slug,
    name: pkg.name,
    summary: pkg.summary,
    audience: pkg.audience,
    categorySlug: pkg.categorySlug,
    pricingMode: pkg.pricingMode,
    fromPriceMinor: fromPrice(pkg, variants),
    currency: "ZAR" as const,
    deliveryWindow: pkg.deliveryWindow,
    isDiscovery: pkg.isDiscovery,
    featured: pkg.featured,
    status: pkg.status,
    soldOut,
    displayOrder: pkg.displayOrder,
  };
}

export async function toPackageDetail(tx: DbOrTx, loaded: NonNullable<Awaited<ReturnType<typeof loadPackage>>>, opts: { includeInactive?: boolean } = {}) {
  const { pkg, variants, options } = loaded;
  const pkgFaqs = await tx
    .select()
    .from(faqs)
    .where(and(eq(faqs.scope, `package:${pkg.slug}`), eq(faqs.published, true)))
    .orderBy(asc(faqs.displayOrder));
  return {
    ...(await toSummary(tx, pkg, variants)),
    description: pkg.description,
    priceMinor: pkg.priceMinor,
    deliverables: pkg.deliverables,
    inclusions: pkg.inclusions,
    exclusions: pkg.exclusions,
    clientResponsibilities: pkg.clientResponsibilities,
    nextSteps: pkg.nextSteps,
    revisions: pkg.revisions,
    warrantySupport: pkg.warrantySupport,
    eligibility: pkg.eligibility,
    cancellationTerms: pkg.cancellationTerms,
    deposit: pkg.deposit,
    capacityLimit: pkg.capacityLimit,
    version: pkg.version,
    variants: variants
      .filter((v) => opts.includeInactive || v.active)
      .map((v) => ({ id: v.id, key: v.key, name: v.name, description: v.description, priceMinor: v.priceMinor, deliveryWindow: v.deliveryWindow, inclusions: v.inclusions, recommended: v.recommended, active: v.active, displayOrder: v.displayOrder })),
    options: options
      .filter((o) => opts.includeInactive || o.active)
      .map((o) => ({ id: o.id, key: o.key, label: o.label, description: o.description, pricingType: o.pricingType, amountMinor: o.amountMinor, unitLabel: o.unitLabel, minQty: o.minQty, maxQty: o.maxQty, rules: o.rules, active: o.active, displayOrder: o.displayOrder })),
    faqs: pkgFaqs.map((f) => ({ id: f.id, scope: f.scope, question: f.question, answer: f.answer, displayOrder: f.displayOrder })),
  };
}

/** Server-authoritative quote. Throws AppError(422) on invalid selections. */
export async function quoteForPackage(app: AppContext, tx: DbOrTx, snapshot: PackageSnapshot, selection: z.infer<typeof packageSelectionSchema>) {
  const tax = await app.settings.tax(tx);
  try {
    const q = quotePackage(snapshot, { variantKey: selection.variantKey ?? null, options: selection.options }, tax);
    return { ...q, taxLabel: tax.enabled ? tax.label : null };
  } catch (e) {
    if (e instanceof SelectionError) throw new AppError(422, "selection_invalid", e.message);
    throw e;
  }
}

const slugParams = z.object({ slug: z.string().max(80) });
const idParams = z.object({ id: z.uuid() });
const childParams = z.object({ id: z.uuid(), childId: z.uuid() });

export function publicCatalogueRoutes(app: AppContext): RouteDef[] {
  const enquiryLimit = limits.contact();
  return [
    defineRoute({
      method: "get",
      path: "/packages",
      summary: "Published (and paused) packages",
      tags: ["public"],
      auth: "public",
      response: z.array(packageSummarySchema),
      handler: async () => {
        const rows = await app.db
          .select()
          .from(packages)
          .where(inArray(packages.status, ["published", "paused"]))
          .orderBy(asc(packages.displayOrder), asc(packages.name));
        const variants = rows.length
          ? await app.db.select().from(packageVariants).where(inArray(packageVariants.packageId, rows.map((r) => r.id)))
          : [];
        return Promise.all(rows.map((p) => toSummary(app.db, p, variants.filter((v) => v.packageId === p.id))));
      },
    }),
    defineRoute({
      method: "get",
      path: "/packages/:slug",
      summary: "Package detail with tiers, add-ons and FAQs",
      tags: ["public"],
      auth: "public",
      params: slugParams,
      response: packageDetailSchema,
      handler: async ({ params }) => {
        const loaded = await loadPackage(app.db, { slug: params.slug });
        if (!loaded || !["published", "paused"].includes(loaded.pkg.status)) throw notFound("Package");
        return toPackageDetail(app.db, loaded);
      },
    }),
    defineRoute({
      method: "post",
      path: "/packages/:slug/quote",
      summary: "Server-calculated price for a tier/add-on selection",
      tags: ["public"],
      auth: "public",
      params: slugParams,
      body: packageSelectionSchema,
      response: packageQuoteSchema,
      handler: async ({ params, body }) => {
        const loaded = await loadPackage(app.db, { slug: params.slug });
        if (!loaded || !["published", "paused"].includes(loaded.pkg.status)) throw notFound("Package");
        if (loaded.pkg.status === "paused") throw new AppError(422, "selection_invalid", "Sales for this package are paused. Request a proposal instead.");
        return quoteForPackage(app, app.db, toSnapshot(loaded), body);
      },
    }),
    defineRoute({
      method: "post",
      path: "/packages/:slug/enquiries",
      summary: "Request a proposal for a package (quote-only or manual-review selections)",
      tags: ["public"],
      auth: "public",
      params: slugParams,
      body: packageEnquiryBody,
      middleware: [enquiryLimit],
      successStatus: 201,
      response: z.object({ reference: z.string() }),
      handler: async ({ params, body, req }) => {
        const loaded = await loadPackage(app.db, { slug: params.slug });
        if (!loaded || !["published", "paused"].includes(loaded.pkg.status)) throw notFound("Package");
        const lines = describeSelection(loaded, body.selection);
        const result = await app.db.transaction(async (tx) => {
          const lead = await captureLead(app, tx, req, {
            source: "package_enquiry",
            contactName: body.name,
            email: body.email,
            phone: body.phone,
            companyName: body.company,
            interest: loaded.pkg.name,
            summary: [`Package enquiry: ${loaded.pkg.name}`, ...lines, body.message].filter(Boolean).join("\n"),
            consentMarketing: body.consentMarketing,
          });
          await tx.insert(leadActivities).values({ leadId: lead.id, type: "enquiry", body: `Requested a proposal for ${loaded.pkg.name}`, metadata: { packageSlug: loaded.pkg.slug, selection: body.selection } });
          return lead;
        });
        app.notifications.kick();
        return { reference: result.reference };
      },
    }),
  ];
}

function describeSelection(loaded: NonNullable<Awaited<ReturnType<typeof loadPackage>>>, sel: z.infer<typeof packageSelectionSchema>): string[] {
  const out: string[] = [];
  if (sel.variantKey) out.push(`Tier: ${loaded.variants.find((v) => v.key === sel.variantKey)?.name ?? sel.variantKey}`);
  for (const o of sel.options) out.push(`Add-on: ${loaded.options.find((x) => x.key === o.key)?.label ?? o.key} × ${o.quantity}`);
  return out;
}

async function bumpVersion(tx: DbOrTx, packageId: string) {
  await tx.update(packages).set({ version: sql`${packages.version} + 1` }).where(eq(packages.id, packageId));
}

export function adminCatalogueRoutes(app: AppContext): RouteDef[] {
  const perm = "packages.manage" as const;
  const withChildren = async (id: string) => {
    const loaded = await loadPackage(app.db, { id });
    if (!loaded) throw notFound("Package");
    return toPackageDetail(app.db, loaded, { includeInactive: true });
  };
  return [
    defineRoute({
      method: "get",
      path: "/admin/packages",
      summary: "All packages with sales counts",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: [perm, "orders.read"],
      handler: async () => {
        const rows = await app.db.select().from(packages).orderBy(asc(packages.displayOrder));
        const variants = await app.db.select().from(packageVariants);
        const sold = await app.db
          .select({ packageId: orders.packageId, n: count() })
          .from(orders)
          .where(ne(orders.status, "pending_payment"))
          .groupBy(orders.packageId);
        return Promise.all(
          rows.map(async (p) => ({
            ...(await toSummary(app.db, p, variants.filter((v) => v.packageId === p.id))),
            version: p.version,
            ordersCount: Number(sold.find((s) => s.packageId === p.id)?.n ?? 0),
            updatedAt: p.updatedAt,
          })),
        );
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/packages/:id",
      summary: "Package with all tiers and add-ons",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: idParams,
      handler: ({ params }) => withChildren(params.id),
    }),
    defineRoute({
      method: "post",
      path: "/admin/packages",
      summary: "Create a package (starts as draft)",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      body: packageUpsertBody,
      successStatus: 201,
      handler: async ({ body, req }) => {
        try {
          const [p] = await app.db.insert(packages).values({ ...body, status: "draft" }).returning();
          await audit(app.db, req, { action: "package.created", entityType: "package", entityId: p.id, after: body });
          return withChildren(p.id);
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A package with that slug already exists.");
          throw e;
        }
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/packages/:id",
      summary: "Update a package. Price changes bump the version; existing orders keep their snapshot.",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: packageUpsertBody,
      handler: async ({ params, body, req }) => {
        try {
          await app.db.transaction(async (tx) => {
            const [before] = await tx.select().from(packages).where(eq(packages.id, params.id));
            if (!before) throw notFound("Package");
            const commercialChange =
              before.priceMinor !== body.priceMinor ||
              before.pricingMode !== body.pricingMode ||
              JSON.stringify(before.deposit) !== JSON.stringify(body.deposit);
            await tx
              .update(packages)
              .set({ ...body, version: commercialChange ? before.version + 1 : before.version })
              .where(eq(packages.id, params.id));
            await audit(tx, req, {
              action: commercialChange ? "package.price_changed" : "package.updated",
              entityType: "package",
              entityId: params.id,
              before: { priceMinor: before.priceMinor, pricingMode: before.pricingMode, deposit: before.deposit, version: before.version },
              after: { priceMinor: body.priceMinor, pricingMode: body.pricingMode, deposit: body.deposit },
            });
          });
          return withChildren(params.id);
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A package with that slug already exists.");
          throw e;
        }
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/packages/:id/status",
      summary: "Publish, pause, archive or return a package to draft",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: packageStatusBody,
      handler: async ({ params, body, req }) => {
        const loaded = await loadPackage(app.db, { id: params.id });
        if (!loaded) throw notFound("Package");
        if (body.status === "published" && loaded.pkg.pricingMode !== "quote_only") {
          const hasPrice = loaded.pkg.priceMinor > 0 || loaded.variants.some((v) => v.active && v.priceMinor > 0);
          if (!hasPrice) throw new AppError(422, "unprocessable", "Set a price (or a priced tier) before publishing.");
        }
        await app.db.update(packages).set({ status: body.status }).where(eq(packages.id, params.id));
        await audit(app.db, req, { action: `package.status.${body.status}`, entityType: "package", entityId: params.id, before: { status: loaded.pkg.status }, after: { status: body.status } });
        return withChildren(params.id);
      },
    }),
    // ------------------------------------------------------------ tiers
    defineRoute({
      method: "post",
      path: "/admin/packages/:id/variants",
      summary: "Add a tier",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: variantUpsertBody,
      successStatus: 201,
      handler: async ({ params, body, req }) => {
        try {
          await app.db.transaction(async (tx) => {
            await tx.insert(packageVariants).values({ ...body, packageId: params.id });
            await bumpVersion(tx, params.id);
            await audit(tx, req, { action: "package.variant_added", entityType: "package", entityId: params.id, after: body });
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A tier with that key already exists.");
          throw e;
        }
        return withChildren(params.id);
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/packages/:id/variants/:childId",
      summary: "Update a tier",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: childParams,
      body: variantUpsertBody,
      handler: async ({ params, body, req }) => {
        await app.db.transaction(async (tx) => {
          const [before] = await tx.select().from(packageVariants).where(and(eq(packageVariants.id, params.childId), eq(packageVariants.packageId, params.id)));
          if (!before) throw notFound("Tier");
          await tx.update(packageVariants).set(body).where(eq(packageVariants.id, params.childId));
          await bumpVersion(tx, params.id);
          await audit(tx, req, { action: "package.variant_updated", entityType: "package", entityId: params.id, before, after: body });
        });
        return withChildren(params.id);
      },
    }),
    // ------------------------------------------------------------ add-ons
    defineRoute({
      method: "post",
      path: "/admin/packages/:id/options",
      summary: "Add an add-on",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: optionUpsertBody,
      successStatus: 201,
      handler: async ({ params, body, req }) => {
        try {
          await app.db.transaction(async (tx) => {
            await tx.insert(packageOptions).values({ ...body, packageId: params.id });
            await bumpVersion(tx, params.id);
            await audit(tx, req, { action: "package.option_added", entityType: "package", entityId: params.id, after: body });
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("An add-on with that key already exists.");
          throw e;
        }
        return withChildren(params.id);
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/packages/:id/options/:childId",
      summary: "Update an add-on",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: childParams,
      body: optionUpsertBody,
      handler: async ({ params, body, req }) => {
        await app.db.transaction(async (tx) => {
          const [before] = await tx.select().from(packageOptions).where(and(eq(packageOptions.id, params.childId), eq(packageOptions.packageId, params.id)));
          if (!before) throw notFound("Add-on");
          await tx.update(packageOptions).set(body).where(eq(packageOptions.id, params.childId));
          await bumpVersion(tx, params.id);
          await audit(tx, req, { action: "package.option_updated", entityType: "package", entityId: params.id, before, after: body });
        });
        return withChildren(params.id);
      },
    }),
    defineRoute({
      method: "delete",
      path: "/admin/packages/:id/options/:childId",
      summary: "Deactivate an add-on (kept for historical orders)",
      tags: ["admin:catalogue"],
      auth: "staff",
      permission: perm,
      params: childParams,
      response: okSchema,
      handler: async ({ params, req }) => {
        await app.db.transaction(async (tx) => {
          await tx.update(packageOptions).set({ active: false }).where(and(eq(packageOptions.id, params.childId), eq(packageOptions.packageId, params.id)));
          await bumpVersion(tx, params.id);
          await audit(tx, req, { action: "package.option_deactivated", entityType: "package", entityId: params.id });
        });
        return { ok: true as const };
      },
    }),
  ];
}
