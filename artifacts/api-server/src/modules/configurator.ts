import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod/v4";
import { configuratorDrafts, configuratorSubmissions, estimates, leadActivities, packages, pricingRuleVersions, type DbOrTx } from "@workspace/db";
import {
  AnswersRulesMismatchError,
  CONFIGURATOR_STEPS,
  DEMO_PRICING_RULES,
  estimateProject,
  pricingRulesSchema,
  type ConfiguratorAnswers,
  type EstimateResult,
  type PricingRules,
} from "@workspace/domain";
import { draftCreateBody, draftResponseSchema, draftUpdateBody, estimateViewSchema, submissionBody } from "@workspace/api-zod";
import { defineRoute, type RouteDef } from "../lib/route";
import { AppError, notFound } from "../lib/errors";
import { addDays, isUniqueViolation, nextNumber } from "../lib/db-helpers";
import { hmacSha256, randomToken, safeEqual, sha256 } from "../lib/crypto";
import { limits } from "../middleware/rate-limit";
import { audit, track } from "../services/audit";
import { captureLead } from "../services/leads";
import { findOrCreateClient, userOrganizationIds } from "../services/accounts";
import { getActiveRules } from "./pricing";
import type { AppContext } from "../context";

const DRAFT_TTL_DAYS = 30;

/** Public view of the rule catalogue: labels and structure only, no coefficients. */
function publicSchema(rules: PricingRules) {
  return {
    steps: CONFIGURATOR_STEPS,
    solutions: rules.solutions.map(({ key, label, description, examples }) => ({ key, label, description, examples })),
    featureGroups: rules.featureGroups,
    features: rules.features.map(({ key, groupKey, label, description, solutions, requires, flags }) => ({ key, groupKey, label, description, solutions, requires, sensitive: flags.length > 0 })),
    integrations: rules.integrations.map(({ key, label, examples }) => ({ key, label, examples })),
    platforms: rules.platforms.map(({ key, label, description, flags }) => ({ key, label, description, native: flags.includes("native_mobile") })),
    internalUserBands: rules.internalUserBands.map(({ key, label }) => ({ key, label })),
    customerUserBands: rules.customerUserBands.map(({ key, label }) => ({ key, label })),
    roleBands: rules.roleBands.map(({ key, label }) => ({ key, label })),
    migrationLevels: rules.migrationLevels.map(({ key, label }) => ({ key, label })),
    brandingReadiness: rules.brandingReadiness.map(({ key, label }) => ({ key, label })),
    urgency: rules.urgency.map(({ key, label, description }) => ({ key, label, description })),
    budgetBands: rules.budgetBands.map(({ key, label }) => ({ key, label })),
    launchTargets: rules.launchTargets.map(({ key, label }) => ({ key, label })),
  };
}

/** Catalogue used to render the form: active rules, else the newest version, else the built-in structure. */
async function catalogueRules(tx: DbOrTx): Promise<{ rules: PricingRules; active: boolean; isDemo: boolean; version: number | null }> {
  const active = await getActiveRules(tx);
  if (active) return { rules: active.rules, active: true, isDemo: active.isDemo, version: active.version };
  const [latest] = await tx.select().from(pricingRuleVersions).orderBy(desc(pricingRuleVersions.version)).limit(1);
  const parsed = latest ? pricingRulesSchema.safeParse(latest.rules) : null;
  if (parsed?.success) return { rules: parsed.data, active: false, isDemo: latest!.isDemo, version: null };
  return { rules: pricingRulesSchema.parse(DEMO_PRICING_RULES), active: false, isDemo: true, version: null };
}

export function estimateAccessToken(secret: string, reference: string) {
  return hmacSha256(secret, `estimate:${reference}`, "base64url").slice(0, 32);
}

function labelsFor(rules: PricingRules, answers: ConfiguratorAnswers) {
  const find = (list: { key: string; label: string }[], k: string) => list.find((x) => x.key === k)?.label ?? k;
  return {
    name: answers.context.name,
    company: answers.context.company ?? "",
    solutionLabels: answers.solution.types.map((k) => find(rules.solutions, k)),
    featureLabels: answers.capabilities.features.map((k) => find(rules.features, k)),
    integrationLabels: answers.integrations.items.map((i) => `${find(rules.integrations, i.key)}${i.vendor ? ` (${i.vendor})` : ""}`),
    platformLabels: answers.platforms.platforms.map((k) => find(rules.platforms, k)),
  };
}

export async function buildEstimateView(app: AppContext, tx: DbOrTx, submission: typeof configuratorSubmissions.$inferSelect) {
  const [est] = await tx.select().from(estimates).where(eq(estimates.submissionId, submission.id)).orderBy(desc(estimates.createdAt)).limit(1);
  const cat = await catalogueRules(tx);
  let rules = cat.rules;
  if (est?.pricingRuleVersionId) {
    const [v] = await tx.select().from(pricingRuleVersions).where(eq(pricingRuleVersions.id, est.pricingRuleVersionId));
    const parsed = v ? pricingRulesSchema.safeParse(v.rules) : null;
    if (parsed?.success) rules = parsed.data;
  }
  let discoveryPackageSlug: string | null = null;
  if (rules.discovery.packageSlug) {
    const [p] = await tx.select({ slug: packages.slug, status: packages.status }).from(packages).where(eq(packages.slug, rules.discovery.packageSlug));
    if (p?.status === "published") discoveryPackageSlug = p.slug;
  }
  return {
    submissionReference: submission.reference,
    estimateReference: est?.reference ?? null,
    createdAt: submission.submittedAt.toISOString(),
    status: submission.status,
    isDemoPricing: est?.isDemoPricing ?? false,
    rulesVersion: est?.rulesVersion ?? null,
    result: (est?.result as EstimateResult | null) ?? null,
    summary: labelsFor(rules, submission.answers),
    discoveryPackageSlug,
  };
}

const tokenParams = z.object({ token: z.string().min(20).max(200) });

export function configuratorRoutes(app: AppContext): RouteDef[] {
  const draftLimit = limits.configuratorDraft();
  const submitLimit = limits.configuratorSubmit();

  const toDraftResponse = (d: typeof configuratorDrafts.$inferSelect, submissionReference: string | null, token?: string) => ({
    ...(token ? { token } : {}),
    answers: d.answers,
    currentStep: d.currentStep,
    updatedAt: d.updatedAt.toISOString(),
    expiresAt: d.expiresAt.toISOString(),
    submitted: Boolean(d.submittedAt),
    submissionReference,
  });

  async function loadDraft(token: string) {
    const [d] = await app.db
      .select()
      .from(configuratorDrafts)
      .where(and(eq(configuratorDrafts.tokenHash, sha256(token)), gt(configuratorDrafts.expiresAt, new Date())));
    if (!d) throw notFound("Saved brief");
    let ref: string | null = null;
    if (d.submissionId) {
      const [s] = await app.db.select({ reference: configuratorSubmissions.reference }).from(configuratorSubmissions).where(eq(configuratorSubmissions.id, d.submissionId));
      ref = s?.reference ?? null;
    }
    return { d, ref };
  }

  return [
    defineRoute({
      method: "get",
      path: "/configurator/schema",
      summary: "Configurator steps and option catalogue (labels only)",
      tags: ["configurator"],
      auth: "public",
      handler: async () => {
        const cat = await catalogueRules(app.db);
        const settings = await app.settings.get("configurator");
        return { enabled: settings.enabled, pricingActive: cat.active, demoPricing: cat.active && cat.isDemo, rulesVersion: cat.version, ...publicSchema(cat.rules) };
      },
    }),
    defineRoute({
      method: "post",
      path: "/configurator/drafts",
      summary: "Start a saved draft; returns a secret resume token",
      tags: ["configurator"],
      auth: "public",
      body: draftCreateBody,
      middleware: [draftLimit],
      successStatus: 201,
      response: draftResponseSchema,
      handler: async ({ body, auth }) => {
        const token = randomToken(24);
        const [d] = await app.db
          .insert(configuratorDrafts)
          .values({
            tokenHash: sha256(token),
            answers: body.answers,
            currentStep: body.currentStep,
            email: body.answers.context?.email ?? auth?.user.email ?? null,
            expiresAt: addDays(new Date(), DRAFT_TTL_DAYS),
          })
          .returning();
        await track(app.db, "configurator_started", { userId: auth?.user.id, entityType: "configurator_draft", entityId: d.id });
        return toDraftResponse(d, null, token);
      },
    }),
    defineRoute({
      method: "get",
      path: "/configurator/drafts/:token",
      summary: "Resume a saved draft",
      tags: ["configurator"],
      auth: "public",
      params: tokenParams,
      middleware: [draftLimit],
      response: draftResponseSchema,
      handler: async ({ params }) => {
        const { d, ref } = await loadDraft(params.token);
        return toDraftResponse(d, ref);
      },
    }),
    defineRoute({
      method: "patch",
      path: "/configurator/drafts/:token",
      summary: "Autosave draft answers; optionally email a resume link",
      tags: ["configurator"],
      auth: "public",
      params: tokenParams,
      body: draftUpdateBody,
      middleware: [draftLimit],
      response: draftResponseSchema,
      handler: async ({ params, body }) => {
        const { d, ref } = await loadDraft(params.token);
        if (d.submittedAt) throw new AppError(409, "conflict", "This brief has already been submitted.");
        const email = body.answers.context?.email ?? d.email;
        const [updated] = await app.db
          .update(configuratorDrafts)
          .set({ answers: body.answers, currentStep: body.currentStep, email, expiresAt: addDays(new Date(), DRAFT_TTL_DAYS) })
          .where(eq(configuratorDrafts.id, d.id))
          .returning();
        if (body.sendResumeLink && email && z.email().safeParse(email).success) {
          await app.db.transaction(async (tx) => {
            await app.notifications.queue(tx, { template: "configurator.resume_link", toEmail: email, channels: ["email"], data: { path: `/configure?resume=${params.token}` } });
            await tx.update(configuratorDrafts).set({ resumeEmailSentAt: new Date() }).where(eq(configuratorDrafts.id, d.id));
          });
          void app.notifications.dispatchPending();
        }
        const stepIndex = CONFIGURATOR_STEPS.findIndex((s) => s.key === body.currentStep);
        if (stepIndex > CONFIGURATOR_STEPS.findIndex((s) => s.key === d.currentStep)) {
          await track(app.db, "configurator_step_completed", { entityType: "configurator_draft", entityId: d.id, properties: { step: d.currentStep } });
        }
        return toDraftResponse(updated, ref);
      },
    }),
    defineRoute({
      method: "post",
      path: "/configurator/submissions",
      summary: "Submit a brief: creates lead + versioned brief + server-side indicative estimate (idempotent)",
      tags: ["configurator"],
      auth: "public",
      body: submissionBody,
      middleware: [submitLimit],
      successStatus: 201,
      response: estimateViewSchema,
      handler: async ({ body, req, auth, status }) => {
        const settings = await app.settings.get("configurator");
        if (!settings.enabled) throw new AppError(422, "unprocessable", "The project configurator is temporarily unavailable. Please use the contact form.");

        // Idempotency: a retried submission returns the original result.
        const [dup] = await app.db.select().from(configuratorSubmissions).where(eq(configuratorSubmissions.idempotencyKey, body.idempotencyKey));
        if (dup) {
          status(200);
          return { ...(await buildEstimateView(app, app.db, dup)), accessToken: estimateAccessToken(app.config.APP_SECRET, dup.reference) };
        }

        const answers = body.answers;
        const active = await getActiveRules(app.db);
        const tax = await app.settings.tax();
        let result: EstimateResult | null = null;
        if (active) {
          try {
            result = estimateProject(answers, active.rules, { tax });
          } catch (e) {
            if (e instanceof AnswersRulesMismatchError) throw new AppError(422, "validation_failed", "Some answers are no longer valid. Please review your selections.", e.issues);
            throw e;
          }
        }

        const runSubmission = () => app.db.transaction(async (tx) => {
          let draftId: string | null = null;
          if (body.draftToken) {
            const [d] = await tx.select().from(configuratorDrafts).where(eq(configuratorDrafts.tokenHash, sha256(body.draftToken)));
            if (d && !d.submittedAt) draftId = d.id;
          }
          let ownership: { userId: string; organizationId: string } | null = null;
          if (auth) {
            const orgs = await userOrganizationIds(tx, auth.user.id);
            if (orgs[0]) ownership = { userId: auth.user.id, organizationId: orgs[0] };
          }
          if (!ownership) {
            const c = await findOrCreateClient(tx, { email: answers.context.email, name: answers.context.name, company: answers.context.company, phone: answers.context.phone });
            ownership = { userId: c.userId, organizationId: c.organizationId };
          }

          const budgetLabel = active?.rules.budgetBands.find((b) => b.key === answers.budget.budgetBand)?.label ?? answers.budget.budgetBand;
          const launchLabel = active?.rules.launchTargets.find((b) => b.key === answers.budget.launchTarget)?.label ?? answers.budget.launchTarget;
          const lead = await captureLead(app, tx, req, {
            source: "configurator",
            contactName: answers.context.name,
            email: answers.context.email,
            phone: answers.context.phone,
            companyName: answers.context.company,
            jobTitle: answers.context.role,
            interest: answers.solution.types.join(", "),
            budgetBand: budgetLabel,
            timeline: launchLabel,
            summary: answers.problem.description,
            consentMarketing: answers.review.consentMarketing,
            attribution: body.attribution,
            silent: true,
          });

          const reference = await nextNumber(tx, "BRF");
          const [sub] = await tx
            .insert(configuratorSubmissions)
            .values({
              reference,
              leadId: lead.id,
              userId: ownership.userId,
              organizationId: ownership.organizationId,
              draftId,
              answers,
              status: result ? "estimate_ready" : "submitted",
              idempotencyKey: body.idempotencyKey,
            })
            .returning();

          const estimateRef = await nextNumber(tx, "EST");
          await tx.insert(estimates).values({
            reference: estimateRef,
            submissionId: sub.id,
            pricingRuleVersionId: active?.id ?? null,
            rulesVersion: active?.version ?? null,
            isDemoPricing: active?.isDemo ?? false,
            lowMinor: result?.lowMinor ?? 0,
            highMinor: result?.highMinor ?? 0,
            totalMinor: result?.totalMinor ?? 0,
            discoveryFeeMinor: result?.discoveryFeeMinor ?? 0,
            depositMinor: result?.depositMinor ?? 0,
            confidence: result?.confidence ?? "low",
            requiresManualReview: result?.requiresManualReview ?? true,
            recommendation: result?.recommendation ?? "intro_call",
            result,
            status: result ? "indicative" : "pending_rules",
          });
          if (draftId) await tx.update(configuratorDrafts).set({ submittedAt: new Date(), submissionId: sub.id }).where(eq(configuratorDrafts.id, draftId));
          await tx.insert(leadActivities).values({
            leadId: lead.id,
            type: "submission",
            body: `Configurator brief ${reference} submitted${result ? ` — indicative ${result.lowMinor / 100}–${result.highMinor / 100} ZAR` : ""}`,
            metadata: { submissionId: sub.id, reference, flags: result?.flags.map((f) => f.code) ?? [] },
          });
          await audit(tx, req, { action: "configurator.submitted", entityType: "configurator_submission", entityId: sub.id, after: { reference, estimate: estimateRef } });
          await track(tx, "configurator_submitted", { userId: ownership.userId, entityType: "configurator_submission", entityId: sub.id });
          if (result) await track(tx, "estimate_generated", { entityType: "estimate", entityId: estimateRef, properties: { confidence: result.confidence, review: result.requiresManualReview } });

          const token = estimateAccessToken(app.config.APP_SECRET, reference);
          await app.notifications.queue(tx, {
            template: "configurator.received",
            userId: ownership.userId,
            toEmail: answers.context.email,
            data: { reference, priced: Boolean(result?.priced), lowMinor: result?.lowMinor, highMinor: result?.highMinor, path: `/estimate/${reference}?token=${token}` },
            dedupeKey: `submission:${sub.id}`,
          });
          await app.notifications.queueStaff(tx, {
            template: "staff.new_lead",
            data: {
              reference,
              name: answers.context.name,
              email: answers.context.email,
              company: answers.context.company,
              source: "configurator",
              summary: answers.problem.description,
              flags: result?.flags.map((f) => f.code).join(", ") || (result ? "" : "pricing rules not active"),
              path: `/admin/submissions/${sub.id}`,
            },
            dedupeKey: `submission-staff:${sub.id}`,
          });
          return sub;
        });
        let submission: typeof configuratorSubmissions.$inferSelect;
        try {
          submission = await runSubmission();
        } catch (e) {
          // Concurrent retry with the same idempotency key: return the winner's result.
          if (!isUniqueViolation(e)) throw e;
          const [winner] = await app.db.select().from(configuratorSubmissions).where(eq(configuratorSubmissions.idempotencyKey, body.idempotencyKey));
          if (!winner) throw e;
          submission = winner;
        }
        void app.notifications.dispatchPending();
        return { ...(await buildEstimateView(app, app.db, submission)), accessToken: estimateAccessToken(app.config.APP_SECRET, submission.reference) };
      },
    }),
    defineRoute({
      method: "get",
      path: "/configurator/estimates/:reference",
      summary: "View an indicative assessment via its private link token",
      tags: ["configurator"],
      auth: "public",
      params: z.object({ reference: z.string().max(40) }),
      query: z.object({ token: z.string().max(100) }),
      response: estimateViewSchema,
      handler: async ({ params, query }) => {
        if (!safeEqual(estimateAccessToken(app.config.APP_SECRET, params.reference), query.token)) throw notFound("Assessment");
        const [sub] = await app.db.select().from(configuratorSubmissions).where(eq(configuratorSubmissions.reference, params.reference));
        if (!sub) throw notFound("Assessment");
        return buildEstimateView(app, app.db, sub);
      },
    }),
  ];
}
