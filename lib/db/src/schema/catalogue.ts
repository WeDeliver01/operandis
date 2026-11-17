import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { DepositRule, OptionPricingType, PricingMode } from "@workspace/domain";
import { createdAt, id, minor, updatedAt } from "./common";

export type PackageStatus = "draft" | "published" | "paused" | "archived";

export const packages = pgTable(
  "packages",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    audience: text("audience").$type<"b2b" | "b2c" | "both">().notNull().default("both"),
    categorySlug: text("category_slug"),
    pricingMode: text("pricing_mode").$type<PricingMode>().notNull().default("fixed"),
    priceMinor: minor("price_minor").notNull().default(0),
    currency: text("currency").$type<"ZAR">().notNull().default("ZAR"),
    deliveryWindow: text("delivery_window").notNull().default(""),
    deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
    inclusions: jsonb("inclusions").$type<string[]>().notNull().default([]),
    exclusions: jsonb("exclusions").$type<string[]>().notNull().default([]),
    clientResponsibilities: jsonb("client_responsibilities").$type<string[]>().notNull().default([]),
    nextSteps: jsonb("next_steps").$type<string[]>().notNull().default([]),
    revisions: text("revisions").notNull().default(""),
    warrantySupport: text("warranty_support").notNull().default(""),
    eligibility: text("eligibility").notNull().default(""),
    cancellationTerms: text("cancellation_terms").notNull().default(""),
    deposit: jsonb("deposit").$type<DepositRule>().notNull().default({ type: "percent", percentBps: 5000 }),
    status: text("status").$type<PackageStatus>().notNull().default("draft"),
    /** Max concurrent active orders; null = unlimited. */
    capacityLimit: integer("capacity_limit"),
    isDiscovery: boolean("is_discovery").notNull().default(false),
    featured: boolean("featured").notNull().default(false),
    displayOrder: integer("display_order").notNull().default(0),
    /** Incremented on every commercial change; orders snapshot the version they bought. */
    version: integer("version").notNull().default(1),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("packages_slug_uq").on(t.slug), index("packages_status_idx").on(t.status, t.displayOrder)],
);

export const packageVariants = pgTable(
  "package_variants",
  {
    id: id(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    priceMinor: minor("price_minor").notNull(),
    deliveryWindow: text("delivery_window").notNull().default(""),
    inclusions: jsonb("inclusions").$type<string[]>().notNull().default([]),
    recommended: boolean("recommended").notNull().default(false),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("package_variants_key_uq").on(t.packageId, t.key)],
);

export interface OptionRules {
  requires: string[];
  excludes: string[];
  variants: string[];
}

export const packageOptions = pgTable(
  "package_options",
  {
    id: id(),
    packageId: uuid("package_id").notNull().references(() => packages.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    label: text("label").notNull(),
    description: text("description").notNull().default(""),
    pricingType: text("pricing_type").$type<OptionPricingType>().notNull().default("fixed"),
    amountMinor: minor("amount_minor").notNull().default(0),
    unitLabel: text("unit_label"),
    minQty: integer("min_qty").notNull().default(1),
    maxQty: integer("max_qty").notNull().default(1),
    rules: jsonb("rules").$type<OptionRules>().notNull().default({ requires: [], excludes: [], variants: [] }),
    active: boolean("active").notNull().default(true),
    displayOrder: integer("display_order").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("package_options_key_uq").on(t.packageId, t.key)],
);
