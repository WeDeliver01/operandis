import { and, asc, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { faqs, portfolioProjects, serviceCategories, testimonials } from "@workspace/db";
import {
  faqSchema,
  faqUpsertBody,
  portfolioDetailSchema,
  portfolioListQuery,
  portfolioSummarySchema,
  portfolioUpsertBody,
  serviceCategorySchema,
  serviceUpsertBody,
  okSchema,
} from "@workspace/api-zod";
import { defineRoute, type RouteDef } from "../lib/route";
import { conflict, notFound } from "../lib/errors";
import { isUniqueViolation } from "../lib/db-helpers";
import { audit } from "../services/audit";
import type { AppContext } from "../context";

type PortfolioRow = typeof portfolioProjects.$inferSelect;

export function toPortfolioSummary(p: PortfolioRow) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    shortDescription: p.shortDescription,
    industry: p.industry,
    projectType: p.projectType,
    statusLabel: p.statusLabel,
    featured: p.featured,
    thumbnailUrl: p.thumbnailUrl,
    logoUrl: p.logoUrl,
    externalUrl: p.externalUrl,
    serviceCategorySlugs: p.serviceCategorySlugs,
    technologyTags: p.technologyTags,
    displayOrder: p.displayOrder,
  };
}

export function toPortfolioDetail(p: PortfolioRow) {
  return {
    ...toPortfolioSummary(p),
    longDescription: p.longDescription,
    challenge: p.challenge,
    approach: p.approach,
    solution: p.solution,
    features: p.features,
    outcomes: p.outcomes,
    stack: p.stack,
    heroUrl: p.heroUrl,
    gallery: p.gallery,
    accessNote: p.accessNote,
    testimonial: p.testimonial ?? null,
    bodyMarkdown: p.bodyMarkdown,
    seoTitle: p.seoTitle,
    seoDescription: p.seoDescription,
  };
}

const toService = (s: typeof serviceCategories.$inferSelect) => ({
  id: s.id,
  slug: s.slug,
  name: s.name,
  eyebrow: s.eyebrow,
  headline: s.headline,
  summary: s.summary,
  description: s.description,
  audiences: s.audiences,
  deliverables: s.deliverables,
  displayOrder: s.displayOrder,
});
const toFaq = (f: typeof faqs.$inferSelect) => ({ id: f.id, scope: f.scope, question: f.question, answer: f.answer, displayOrder: f.displayOrder });

const idParams = z.object({ id: z.uuid() });

export function publicContentRoutes(app: AppContext): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/portfolio",
      summary: "Published portfolio projects (case studies)",
      tags: ["public"],
      auth: "public",
      query: portfolioListQuery,
      response: z.array(portfolioSummarySchema),
      handler: async ({ query }) => {
        const rows = await app.db
          .select()
          .from(portfolioProjects)
          .where(
            and(
              eq(portfolioProjects.publicationStatus, "published"),
              query.featured ? eq(portfolioProjects.featured, query.featured === "true") : undefined,
              query.category ? sql`${portfolioProjects.serviceCategorySlugs} ? ${query.category}` : undefined,
            ),
          )
          .orderBy(asc(portfolioProjects.displayOrder), asc(portfolioProjects.title));
        return rows.map(toPortfolioSummary);
      },
    }),
    defineRoute({
      method: "get",
      path: "/portfolio/:slug",
      summary: "A published case study",
      tags: ["public"],
      auth: "public",
      params: z.object({ slug: z.string().max(80) }),
      response: portfolioDetailSchema,
      handler: async ({ params }) => {
        const [p] = await app.db
          .select()
          .from(portfolioProjects)
          .where(and(eq(portfolioProjects.slug, params.slug), eq(portfolioProjects.publicationStatus, "published")));
        if (!p) throw notFound("Project");
        return toPortfolioDetail(p);
      },
    }),
    defineRoute({
      method: "get",
      path: "/services",
      summary: "Active service categories",
      tags: ["public"],
      auth: "public",
      response: z.array(serviceCategorySchema),
      handler: async () => {
        const rows = await app.db.select().from(serviceCategories).where(eq(serviceCategories.active, true)).orderBy(asc(serviceCategories.displayOrder));
        return rows.map(toService);
      },
    }),
    defineRoute({
      method: "get",
      path: "/faqs",
      summary: "Published FAQs for a scope (home, packages, configurator, package:<slug>)",
      tags: ["public"],
      auth: "public",
      query: z.object({ scope: z.string().max(100) }),
      response: z.array(faqSchema),
      handler: async ({ query }) => {
        const rows = await app.db
          .select()
          .from(faqs)
          .where(and(eq(faqs.scope, query.scope), eq(faqs.published, true)))
          .orderBy(asc(faqs.displayOrder));
        return rows.map(toFaq);
      },
    }),
    defineRoute({
      method: "get",
      path: "/testimonials",
      summary: "Published testimonials",
      tags: ["public"],
      auth: "public",
      handler: async () =>
        app.db
          .select({ id: testimonials.id, quote: testimonials.quote, author: testimonials.author, role: testimonials.role, company: testimonials.company })
          .from(testimonials)
          .where(eq(testimonials.published, true))
          .orderBy(asc(testimonials.displayOrder)),
    }),
  ];
}

export function adminContentRoutes(app: AppContext): RouteDef[] {
  const perm = "content.manage" as const;
  return [
    // ------------------------------------------------------------ portfolio CMS
    defineRoute({
      method: "get",
      path: "/admin/portfolio",
      summary: "All portfolio projects (any status)",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      handler: async () => {
        const rows = await app.db.select().from(portfolioProjects).orderBy(asc(portfolioProjects.displayOrder));
        return rows.map((p) => ({ ...toPortfolioDetail(p), publicationStatus: p.publicationStatus, updatedAt: p.updatedAt }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/portfolio/:id",
      summary: "Portfolio project for editing",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      params: idParams,
      handler: async ({ params }) => {
        const [p] = await app.db.select().from(portfolioProjects).where(eq(portfolioProjects.id, params.id));
        if (!p) throw notFound("Project");
        return { ...toPortfolioDetail(p), publicationStatus: p.publicationStatus };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/portfolio",
      summary: "Create a portfolio project",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      body: portfolioUpsertBody,
      successStatus: 201,
      handler: async ({ body, req }) => {
        try {
          return await app.db.transaction(async (tx) => {
            const [p] = await tx
              .insert(portfolioProjects)
              .values({ ...body, publishedAt: body.publicationStatus === "published" ? new Date() : null })
              .returning();
            await audit(tx, req, { action: "portfolio.created", entityType: "portfolio_project", entityId: p.id, after: body });
            return toPortfolioDetail(p);
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A project with that slug already exists.");
          throw e;
        }
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/portfolio/:id",
      summary: "Update a portfolio project",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: portfolioUpsertBody,
      handler: async ({ params, body, req }) => {
        try {
          return await app.db.transaction(async (tx) => {
            const [before] = await tx.select().from(portfolioProjects).where(eq(portfolioProjects.id, params.id));
            if (!before) throw notFound("Project");
            const publishedAt = body.publicationStatus === "published" ? (before.publishedAt ?? new Date()) : before.publishedAt;
            const [p] = await tx.update(portfolioProjects).set({ ...body, publishedAt }).where(eq(portfolioProjects.id, params.id)).returning();
            await audit(tx, req, { action: "portfolio.updated", entityType: "portfolio_project", entityId: p.id, before: toPortfolioSummary(before), after: toPortfolioSummary(p) });
            return toPortfolioDetail(p);
          });
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A project with that slug already exists.");
          throw e;
        }
      },
    }),
    // ------------------------------------------------------------ services
    defineRoute({
      method: "get",
      path: "/admin/services",
      summary: "All service categories",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      handler: async () => {
        const rows = await app.db.select().from(serviceCategories).orderBy(asc(serviceCategories.displayOrder));
        return rows.map((s) => ({ ...toService(s), active: s.active }));
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/services",
      summary: "Create a service category",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      body: serviceUpsertBody,
      successStatus: 201,
      handler: async ({ body, req }) => {
        try {
          const [s] = await app.db.insert(serviceCategories).values(body).returning();
          await audit(app.db, req, { action: "service.created", entityType: "service_category", entityId: s.id, after: body });
          return toService(s);
        } catch (e) {
          if (isUniqueViolation(e)) throw conflict("A service with that slug already exists.");
          throw e;
        }
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/services/:id",
      summary: "Update a service category",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: serviceUpsertBody,
      handler: async ({ params, body, req }) => {
        const [s] = await app.db.update(serviceCategories).set(body).where(eq(serviceCategories.id, params.id)).returning();
        if (!s) throw notFound("Service");
        await audit(app.db, req, { action: "service.updated", entityType: "service_category", entityId: s.id, after: body });
        return toService(s);
      },
    }),
    // ------------------------------------------------------------ FAQs
    defineRoute({
      method: "get",
      path: "/admin/faqs",
      summary: "All FAQs",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      handler: async () => {
        const rows = await app.db.select().from(faqs).orderBy(asc(faqs.scope), asc(faqs.displayOrder));
        return rows.map((f) => ({ ...toFaq(f), published: f.published }));
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/faqs",
      summary: "Create an FAQ",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      body: faqUpsertBody,
      successStatus: 201,
      handler: async ({ body, req }) => {
        const [f] = await app.db.insert(faqs).values(body).returning();
        await audit(app.db, req, { action: "faq.created", entityType: "faq", entityId: f.id });
        return toFaq(f);
      },
    }),
    defineRoute({
      method: "put",
      path: "/admin/faqs/:id",
      summary: "Update an FAQ",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      params: idParams,
      body: faqUpsertBody,
      handler: async ({ params, body, req }) => {
        const [f] = await app.db.update(faqs).set(body).where(eq(faqs.id, params.id)).returning();
        if (!f) throw notFound("FAQ");
        await audit(app.db, req, { action: "faq.updated", entityType: "faq", entityId: f.id });
        return toFaq(f);
      },
    }),
    defineRoute({
      method: "delete",
      path: "/admin/faqs/:id",
      summary: "Delete an FAQ (content only, not a business record)",
      tags: ["admin:content"],
      auth: "staff",
      permission: perm,
      params: idParams,
      response: okSchema,
      handler: async ({ params, req }) => {
        await app.db.delete(faqs).where(eq(faqs.id, params.id));
        await audit(app.db, req, { action: "faq.deleted", entityType: "faq", entityId: params.id });
        return { ok: true as const };
      },
    }),
  ];
}
