import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod/v4";
import { pricingRuleVersions, type DbOrTx } from "@workspace/db";
import { configuratorSubmissionAnswers, estimateProject, pricingRulesSchema, AnswersRulesMismatchError, hasPermission, type PricingRules } from "@workspace/domain";
import { pricingActivateBody, pricingVersionCreateBody, pricingVersionUpdateBody } from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, conflict, forbidden, notFound } from "../lib/errors";
import { audit } from "../services/audit";
import type { AppContext } from "../context";

export async function getActiveRules(tx: DbOrTx): Promise<{ id: string; version: number; isDemo: boolean; rules: PricingRules } | null> {
  const [row] = await tx.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.status, "active")).limit(1);
  if (!row) return null;
  const parsed = pricingRulesSchema.safeParse(row.rules);
  if (!parsed.success) return null;
  return { id: row.id, version: row.version, isDemo: row.isDemo, rules: parsed.data };
}

const idParams = z.object({ id: z.uuid() });

const summary = (r: typeof pricingRuleVersions.$inferSelect) => ({
  id: r.id,
  version: r.version,
  name: r.name,
  status: r.status,
  isDemo: r.isDemo,
  notes: r.notes,
  effectiveFrom: r.effectiveFrom,
  approvedAt: r.approvedAt,
  approvedById: r.approvedById,
  createdById: r.createdById,
  rowVersion: r.rowVersion,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function adminPricingRoutes(app: AppContext): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/admin/pricing-rules",
      summary: "Pricing rule versions",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      handler: async () => (await app.db.select().from(pricingRuleVersions).orderBy(desc(pricingRuleVersions.version))).map(summary),
    }),
    defineRoute({
      method: "get",
      path: "/admin/pricing-rules/:id",
      summary: "A pricing rule version including its rules JSON",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      params: idParams,
      handler: async ({ params }) => {
        const [r] = await app.db.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.id, params.id));
        if (!r) throw notFound("Pricing version");
        return { ...summary(r), rules: r.rules };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/pricing-rules",
      summary: "Create a new draft pricing version",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      body: pricingVersionCreateBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        return app.db.transaction(async (tx) => {
          const [{ v }] = await tx.select({ v: max(pricingRuleVersions.version) }).from(pricingRuleVersions);
          const [row] = await tx
            .insert(pricingRuleVersions)
            .values({ version: (v ?? 0) + 1, name: body.name, notes: body.notes, rules: body.rules, isDemo: body.isDemo, status: "draft", createdById: a.user.id })
            .returning();
          await audit(tx, req, { action: "pricing.version_created", entityType: "pricing_rule_version", entityId: row.id, after: { version: row.version, name: row.name } });
          return { ...summary(row), rules: row.rules };
        });
      },
    }),
    defineRoute({
      method: "patch",
      path: "/admin/pricing-rules/:id",
      summary: "Edit a draft version (optimistic concurrency via rowVersion). Active/retired versions are immutable.",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      params: idParams,
      body: pricingVersionUpdateBody,
      handler: async ({ params, body, req }) => {
        return app.db.transaction(async (tx) => {
          const [before] = await tx.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.id, params.id));
          if (!before) throw notFound("Pricing version");
          if (before.status !== "draft") throw conflict("Only draft versions can be edited. Create a new version instead.");
          const rows = await tx
            .update(pricingRuleVersions)
            .set({
              ...(body.name !== undefined ? { name: body.name } : {}),
              ...(body.notes !== undefined ? { notes: body.notes } : {}),
              ...(body.rules !== undefined ? { rules: body.rules } : {}),
              rowVersion: before.rowVersion + 1,
            })
            .where(and(eq(pricingRuleVersions.id, params.id), eq(pricingRuleVersions.rowVersion, body.rowVersion)))
            .returning();
          if (!rows[0]) throw conflict("Someone else changed this version. Reload and try again.", "version_conflict");
          await audit(tx, req, { action: "pricing.version_updated", entityType: "pricing_rule_version", entityId: params.id, before: before.rules, after: rows[0].rules });
          return { ...summary(rows[0]), rules: rows[0].rules };
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/pricing-rules/:id/activate",
      summary: "Approve and activate a version (retires the current active version). Requires pricing.approve unless the version is demo-only.",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      params: idParams,
      body: pricingActivateBody,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        return app.db.transaction(async (tx) => {
          const [target] = await tx.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.id, params.id));
          if (!target) throw notFound("Pricing version");
          if (!target.isDemo && !hasPermission(a.user.role, "pricing.approve")) throw forbidden("Only the owner can approve a production rate card.");
          if (target.rowVersion !== body.rowVersion) throw conflict("This version changed since you loaded it.", "version_conflict");
          if (target.status === "active") return summary(target);
          const parsed = pricingRulesSchema.safeParse(target.rules);
          if (!parsed.success) throw new AppError(422, "unprocessable", "These rules are invalid and cannot be activated.");
          await tx.update(pricingRuleVersions).set({ status: "retired" }).where(eq(pricingRuleVersions.status, "active"));
          const [row] = await tx
            .update(pricingRuleVersions)
            .set({ status: "active", approvedById: a.user.id, approvedAt: new Date(), effectiveFrom: body.effectiveFrom ? new Date(body.effectiveFrom) : new Date(), rowVersion: target.rowVersion + 1 })
            .where(eq(pricingRuleVersions.id, params.id))
            .returning();
          await audit(tx, req, { action: "pricing.version_activated", entityType: "pricing_rule_version", entityId: row.id, after: { version: row.version, isDemo: row.isDemo } });
          return summary(row);
        });
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/pricing-rules/:id/preview",
      summary: "Run the estimate engine against a version without saving anything",
      tags: ["admin:pricing"],
      auth: "staff",
      permission: "pricing.manage",
      params: idParams,
      body: z.object({ answers: configuratorSubmissionAnswers }),
      handler: async ({ params, body }) => {
        const [r] = await app.db.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.id, params.id));
        if (!r) throw notFound("Pricing version");
        try {
          return estimateProject(body.answers, pricingRulesSchema.parse(r.rules), { tax: await app.settings.tax() });
        } catch (e) {
          if (e instanceof AnswersRulesMismatchError) throw new AppError(422, "unprocessable", e.message);
          throw e;
        }
      },
    }),
  ];
}
