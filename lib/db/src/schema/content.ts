import { boolean, index, integer, jsonb, pgTable, text, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createdAt, id, ts, updatedAt } from "./common";

export type PublicationStatus = "draft" | "published" | "archived";
export type PortfolioStatusLabel = "live" | "in_development" | "concept" | "internal_tool";

export const serviceCategories = pgTable(
  "service_categories",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    eyebrow: text("eyebrow").notNull().default(""),
    headline: text("headline").notNull().default(""),
    summary: text("summary").notNull().default(""),
    description: text("description").notNull().default(""),
    audiences: jsonb("audiences").$type<string[]>().notNull().default([]),
    deliverables: jsonb("deliverables").$type<string[]>().notNull().default([]),
    displayOrder: integer("display_order").notNull().default(0),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("service_categories_slug_uq").on(t.slug)],
);

export interface GalleryImage {
  url: string;
  caption?: string;
  alt?: string;
}
export interface Testimonial {
  quote: string;
  author: string;
  role?: string;
  company?: string;
}

export const portfolioProjects = pgTable(
  "portfolio_projects",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    shortDescription: text("short_description").notNull().default(""),
    longDescription: text("long_description").notNull().default(""),
    challenge: text("challenge").notNull().default(""),
    approach: text("approach").notNull().default(""),
    solution: text("solution").notNull().default(""),
    features: jsonb("features").$type<string[]>().notNull().default([]),
    outcomes: jsonb("outcomes").$type<string[]>().notNull().default([]),
    industry: text("industry").notNull().default(""),
    projectType: text("project_type").notNull().default(""),
    stack: text("stack").notNull().default(""),
    technologyTags: jsonb("technology_tags").$type<string[]>().notNull().default([]),
    serviceCategorySlugs: jsonb("service_category_slugs").$type<string[]>().notNull().default([]),
    thumbnailUrl: text("thumbnail_url"),
    heroUrl: text("hero_url"),
    logoUrl: text("logo_url"),
    gallery: jsonb("gallery").$type<GalleryImage[]>().notNull().default([]),
    externalUrl: text("external_url"),
    accessNote: text("access_note"),
    featured: boolean("featured").notNull().default(false),
    statusLabel: text("status_label").$type<PortfolioStatusLabel>().notNull().default("live"),
    publicationStatus: text("publication_status").$type<PublicationStatus>().notNull().default("draft"),
    displayOrder: integer("display_order").notNull().default(0),
    testimonial: jsonb("testimonial").$type<Testimonial | null>(),
    /** Optional long-form Markdown body. When empty, the bundled MDX case study (if any) is shown. */
    bodyMarkdown: text("body_markdown").notNull().default(""),
    seoTitle: text("seo_title"),
    seoDescription: text("seo_description"),
    publishedAt: ts("published_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("portfolio_slug_uq").on(t.slug), index("portfolio_pub_idx").on(t.publicationStatus, t.displayOrder)],
);

export const faqs = pgTable(
  "faqs",
  {
    id: id(),
    /** "home", "packages", "configurator", "package:<slug>" */
    scope: text("scope").notNull(),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    displayOrder: integer("display_order").notNull().default(0),
    published: boolean("published").notNull().default(true),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("faqs_scope_idx").on(t.scope, t.displayOrder)],
);

export const testimonials = pgTable("testimonials", {
  id: id(),
  quote: text("quote").notNull(),
  author: text("author").notNull(),
  role: text("role"),
  company: text("company"),
  portfolioProjectId: uuid("portfolio_project_id").references(() => portfolioProjects.id, { onDelete: "set null" }),
  published: boolean("published").notNull().default(false),
  displayOrder: integer("display_order").notNull().default(0),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});
