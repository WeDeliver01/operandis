import { and, desc, eq, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod/v4";
import {
  creditNotes,
  invoices,
  leadActivities,
  orderItems,
  orders,
  organizations,
  paymentAttempts,
  paymentTransactions,
  projects,
  refunds,
  users,
  webhookEvents,
  type DbOrTx,
  type PaymentProvider,
} from "@workspace/db";
import { invoiceMachine, orderMachine } from "@workspace/domain";
import {
  checkoutBody,
  checkoutResponseSchema,
  invoiceCreateBody,
  invoiceVoidBody,
  offlinePaymentBody,
  orderStatusSchema,
  paginationQuery,
  refundBody,
  type PaymentRedirect,
} from "@workspace/api-zod";
import { defineRoute, requireUser, type RouteDef } from "../lib/route";
import { AppError, conflict, notFound } from "../lib/errors";
import { cursorOrder, cursorWhere, isUniqueViolation, likePattern, nextNumber, pageOf } from "../lib/db-helpers";
import { hmacSha256, randomToken, safeEqual } from "../lib/crypto";
import { limits } from "../middleware/rate-limit";
import { audit, track } from "../services/audit";
import { assertOrgAccess, findOrCreateClient, userOrganizationIds } from "../services/accounts";
import { captureLead } from "../services/leads";
import { invoiceBalance, isOverdue, issueInvoice } from "../services/invoicing";
import { renderInvoicePdf } from "../services/pdf";
import { applyRefundCompletion, applySuccessfulPayment, processVerifiedEvent, recordWebhookEvent } from "../services/payment-processing";
import { ProviderError } from "../services/payments";
import { activeOrderCount, loadPackage, quoteForPackage, toSnapshot } from "./catalogue";
import { requireVerifiedClient } from "./portal";
import type { AppContext } from "../context";

type Attempt = typeof paymentAttempts.$inferSelect;

export function orderAccessToken(secret: string, reference: string) {
  return hmacSha256(secret, `order:${reference}`, "base64url").slice(0, 32);
}

/** Choose a provider that is enabled in settings AND has credentials. */
async function resolveProvider(app: AppContext, requested?: PaymentProvider): Promise<PaymentProvider> {
  const commerce = await app.settings.commerce();
  const available = app.payments.available(commerce.enabledProviders).map((a) => a.key);
  if (available.length === 0) throw new AppError(422, "payment_not_configured", "Online payment isn't available yet. Please request a proposal or contact us.");
  if (requested) {
    if (!available.includes(requested)) throw new AppError(422, "payment_not_configured", "That payment method isn't available.");
    return requested;
  }
  return commerce.defaultProvider && available.includes(commerce.defaultProvider) ? commerce.defaultProvider : available[0];
}

/** Create a payment attempt and the provider-side checkout. */
export async function startPayment(
  app: AppContext,
  input: { organizationId: string; orderId?: string | null; invoiceId?: string | null; purpose: "checkout" | "invoice"; amountMinor: number; description: string; customer: { name: string; email: string }; provider: PaymentProvider; createdById: string | null; returnPath: string; idempotencyKey?: string },
): Promise<{ attempt: Attempt; redirect: PaymentRedirect }> {
  const adapter = app.payments.get(input.provider);
  if (!adapter || !adapter.configured()) throw new AppError(422, "payment_not_configured", "That payment method isn't available.");
  const reference = await app.db.transaction((tx) => nextNumber(tx, "PAY", new Date(), 6));
  const [attempt] = await app.db
    .insert(paymentAttempts)
    .values({
      reference,
      organizationId: input.organizationId,
      orderId: input.orderId ?? null,
      invoiceId: input.invoiceId ?? null,
      provider: input.provider,
      purpose: input.purpose,
      amountMinor: input.amountMinor,
      idempotencyKey: input.idempotencyKey ?? `${input.purpose}:${reference}`,
      createdById: input.createdById,
    })
    .returning();
  const web = app.config.PUBLIC_WEB_URL;
  const returnUrl = `${web}${input.returnPath}${input.returnPath.includes("?") ? "&" : "?"}attempt=${attempt.reference}`;
  try {
    const checkout = await adapter.createCheckout({
      reference,
      amountMinor: input.amountMinor,
      currency: "ZAR",
      description: input.description,
      customer: input.customer,
      returnUrl,
      cancelUrl: `${returnUrl}&cancelled=1`,
      notifyUrl: `${app.config.publicApiUrl}/api/v1/webhooks/payments/${input.provider}`,
      idempotencyKey: attempt.idempotencyKey,
    });
    const [updated] = await app.db
      .update(paymentAttempts)
      .set({ providerCheckoutId: checkout.providerCheckoutId, redirectUrl: checkout.url, status: input.provider === "eft" ? "created" : "redirected" })
      .where(eq(paymentAttempts.id, attempt.id))
      .returning();
    const commerce = await app.settings.commerce();
    return {
      attempt: updated,
      redirect: {
        attemptId: updated.id,
        reference,
        provider: input.provider,
        method: checkout.method,
        url: checkout.url,
        fields: checkout.fields,
        eft: input.provider === "eft" ? { ...commerce.eft, reference, amountMinor: input.amountMinor } : null,
      },
    };
  } catch (err) {
    await app.db.update(paymentAttempts).set({ status: "failed", failureReason: "Could not start checkout with provider" }).where(eq(paymentAttempts.id, attempt.id));
    if (err instanceof ProviderError) throw new AppError(502, "payment_provider_error", "The payment provider is unavailable. Please try again shortly.");
    throw err;
  }
}

async function latestAttempt(tx: DbOrTx, where: { orderId?: string; invoiceId?: string }) {
  const [a] = await tx
    .select()
    .from(paymentAttempts)
    .where(where.orderId ? eq(paymentAttempts.orderId, where.orderId) : eq(paymentAttempts.invoiceId, where.invoiceId!))
    .orderBy(desc(paymentAttempts.createdAt))
    .limit(1);
  return a ?? null;
}

async function orderStatusView(app: AppContext, order: typeof orders.$inferSelect) {
  const attempt = await latestAttempt(app.db, { orderId: order.id });
  const snap = order.snapshot as { package?: { name?: string }; quote?: { dueNowMinor?: number } };
  const paymentStatus = attempt ? (attempt.status as z.infer<typeof orderStatusSchema>["paymentStatus"]) : "pending";
  return {
    orderReference: order.reference,
    status: order.status,
    paymentStatus,
    totalMinor: order.totalMinor,
    dueNowMinor: snap.quote?.dueNowMinor ?? order.depositMinor,
    packageName: snap.package?.name ?? null,
    provider: attempt?.provider ?? null,
    failureReason: attempt?.failureReason ?? null,
    canRetry: order.status === "pending_payment" && (!attempt || ["failed", "cancelled", "expired", "redirected", "created"].includes(attempt.status)),
  };
}

const refParams = z.object({ reference: z.string().max(40) });
const idParams = z.object({ id: z.uuid() });

export function checkoutRoutes(app: AppContext): RouteDef[] {
  const limit = limits.checkout();
  return [
    defineRoute({
      method: "get",
      path: "/checkout/providers",
      summary: "Payment methods currently available",
      tags: ["checkout"],
      auth: "public",
      handler: async () => {
        const commerce = await app.settings.commerce();
        return app.payments.available(commerce.enabledProviders).map((a) => ({ key: a.key, label: a.label, default: a.key === commerce.defaultProvider }));
      },
    }),
    defineRoute({
      method: "post",
      path: "/checkout/sessions",
      summary: "Create an order and payment attempt for a package; returns a hosted-checkout redirect (idempotent)",
      tags: ["checkout"],
      auth: "public",
      body: checkoutBody,
      middleware: [limit],
      successStatus: 201,
      response: checkoutResponseSchema,
      handler: async ({ body, auth, req, status }) => {
        // Idempotent replay: same key returns the same order (and a fresh redirect if still unpaid).
        const [existing] = await app.db.select().from(orders).where(eq(orders.idempotencyKey, body.idempotencyKey));
        if (existing) {
          status(200);
          return replayCheckout(app, existing, body.provider);
        }

        const loaded = await loadPackage(app.db, { slug: body.packageSlug });
        if (!loaded || loaded.pkg.status !== "published") throw notFound("Package");
        if (body.expectedVersion !== undefined && body.expectedVersion !== loaded.pkg.version) {
          throw conflict("This package's pricing was updated while you were checking out. Please review the new price.", "version_conflict");
        }
        if (loaded.pkg.capacityLimit !== null && (await activeOrderCount(app.db, loaded.pkg.id)) >= loaded.pkg.capacityLimit) {
          throw new AppError(422, "unprocessable", "This package is fully booked right now. Join the waiting list via a proposal request.");
        }
        const commerce = await app.settings.commerce();
        if (body.termsVersion !== commerce.termsVersion) throw conflict("Our terms were updated. Please review and accept the current terms.", "version_conflict");
        const snapshot = toSnapshot(loaded);
        const quote = await quoteForPackage(app, app.db, snapshot, body.selection);
        if (!quote.purchasable) throw new AppError(422, "selection_invalid", quote.requiresQuoteReasons[0] ?? "This selection needs a proposal.");
        if (quote.dueNowMinor <= 0) throw new AppError(422, "selection_invalid", "Nothing is due for this selection.");
        const provider = await resolveProvider(app, body.provider);

        const order = await app.db.transaction(async (tx) => {
          let ownership: { userId: string; organizationId: string };
          if (auth) {
            const orgs = await userOrganizationIds(tx, auth.user.id);
            if (!orgs[0]) throw new AppError(422, "unprocessable", "Your account has no billing organisation.");
            ownership = { userId: auth.user.id, organizationId: orgs[0] };
          } else {
            const c = await findOrCreateClient(tx, { email: body.billing.email, name: body.billing.name, company: body.billing.company, phone: body.billing.phone });
            if (!c.created && (c.hasPassword || c.role !== "client")) {
              throw new AppError(409, "account_exists", "You already have an account with this email. Please sign in to complete your purchase.");
            }
            ownership = { userId: c.userId, organizationId: c.organizationId };
          }
          if (body.billing.vatNumber || body.billing.address) {
            await tx
              .update(organizations)
              .set({ ...(body.billing.vatNumber ? { vatNumber: body.billing.vatNumber } : {}), ...(body.billing.address ? { billingAddress: body.billing.address } : {}) })
              .where(eq(organizations.id, ownership.organizationId));
          }
          const lead = await captureLead(app, tx, req, {
            source: loaded.pkg.isDiscovery ? "discovery" : "checkout",
            contactName: body.billing.name,
            email: body.billing.email,
            phone: body.billing.phone,
            companyName: body.billing.company,
            interest: loaded.pkg.name,
            summary: `Checkout started: ${loaded.pkg.name}${body.submissionReference ? ` (brief ${body.submissionReference})` : ""}`,
            silent: true,
          });
          const reference = await nextNumber(tx, "ORD");
          const [o] = await tx
            .insert(orders)
            .values({
              reference,
              organizationId: ownership.organizationId,
              userId: ownership.userId,
              leadId: lead.id,
              source: loaded.pkg.isDiscovery ? "discovery" : "package",
              packageId: loaded.pkg.id,
              packageVersion: loaded.pkg.version,
              status: "pending_payment",
              subtotalMinor: quote.subtotalMinor,
              taxMinor: quote.taxMinor,
              totalMinor: quote.totalMinor,
              depositMinor: quote.depositMinor,
              billingDetails: body.billing,
              termsAcceptedAt: new Date(),
              termsVersion: commerce.termsVersion,
              snapshot: {
                package: { id: loaded.pkg.id, slug: loaded.pkg.slug, name: loaded.pkg.name, version: loaded.pkg.version, isDiscovery: loaded.pkg.isDiscovery, deliverables: loaded.pkg.deliverables, inclusions: loaded.pkg.inclusions, exclusions: loaded.pkg.exclusions, deliveryWindow: loaded.pkg.deliveryWindow, cancellationTerms: loaded.pkg.cancellationTerms },
                pricing: snapshot,
                selection: body.selection,
                quote,
                submissionReference: body.submissionReference ?? null,
                refundPolicy: commerce.refundPolicySummary,
              },
              idempotencyKey: body.idempotencyKey,
            })
            .returning();
          await tx.insert(orderItems).values(quote.lines.map((l) => ({ orderId: o.id, kind: l.kind as "package", key: l.key, description: l.description, quantity: l.quantity, unitMinor: l.unitMinor, totalMinor: l.totalMinor })));
          await tx.insert(leadActivities).values({ leadId: lead.id, type: "order_event", body: `Checkout started for ${loaded.pkg.name} (${reference})`, metadata: { orderId: o.id } });
          await audit(tx, req, { action: "order.created", entityType: "order", entityId: o.id, after: { reference, totalMinor: o.totalMinor, packageVersion: loaded.pkg.version } });
          await track(tx, loaded.pkg.isDiscovery ? "discovery_checkout_started" : "checkout_started", { userId: ownership.userId, entityType: "order", entityId: o.id });
          return o;
        }).catch(async (e) => {
          if (isUniqueViolation(e)) {
            const [winner] = await app.db.select().from(orders).where(eq(orders.idempotencyKey, body.idempotencyKey));
            if (winner) return winner;
          }
          throw e;
        });

        const { redirect } = await startPayment(app, {
          organizationId: order.organizationId,
          orderId: order.id,
          purpose: "checkout",
          amountMinor: quote.dueNowMinor,
          description: `${loaded.pkg.name} (${order.reference})`,
          customer: { name: body.billing.name, email: body.billing.email },
          provider,
          createdById: order.userId,
          returnPath: `/checkout/return?order=${order.reference}&token=${orderAccessToken(app.config.APP_SECRET, order.reference)}`,
        });
        return { orderId: order.id, orderReference: order.reference, accessToken: orderAccessToken(app.config.APP_SECRET, order.reference), payment: redirect };
      },
    }),
    defineRoute({
      method: "get",
      path: "/checkout/orders/:reference",
      summary: "Order payment status for the checkout return page (status comes from verified provider events only)",
      tags: ["checkout"],
      auth: "public",
      params: refParams,
      query: z.object({ token: z.string().max(100) }),
      response: orderStatusSchema,
      handler: async ({ params, query }) => {
        if (!safeEqual(orderAccessToken(app.config.APP_SECRET, params.reference), query.token)) throw notFound("Order");
        const [order] = await app.db.select().from(orders).where(eq(orders.reference, params.reference));
        if (!order) throw notFound("Order");
        return orderStatusView(app, order);
      },
    }),
    defineRoute({
      method: "post",
      path: "/checkout/orders/:reference/retry",
      summary: "Start a new payment attempt for an unpaid order",
      tags: ["checkout"],
      auth: "public",
      params: refParams,
      body: z.object({ token: z.string().max(100), provider: z.enum(["payfast", "yoco", "eft"]).optional() }),
      middleware: [limit],
      response: checkoutResponseSchema,
      handler: async ({ params, body }) => {
        if (!safeEqual(orderAccessToken(app.config.APP_SECRET, params.reference), body.token)) throw notFound("Order");
        const [order] = await app.db.select().from(orders).where(eq(orders.reference, params.reference));
        if (!order) throw notFound("Order");
        return replayCheckout(app, order, body.provider, true);
      },
    }),
  ];
}

async function replayCheckout(app: AppContext, order: typeof orders.$inferSelect, requested?: PaymentProvider, forceNew = false) {
  if (order.status !== "pending_payment") throw conflict("This order is already paid or closed.");
  const last = await latestAttempt(app.db, { orderId: order.id });
  if (last?.status === "succeeded" || last?.status === "pending_verification") throw conflict("A payment for this order is already being processed.");
  const provider = await resolveProvider(app, requested ?? last?.provider);
  if (!forceNew && last && ["created", "redirected"].includes(last.status) && last.provider === provider && provider !== "yoco") {
    // PayFast/EFT checkouts are deterministic — rebuild the redirect for the same attempt.
  }
  if (last && ["created", "redirected"].includes(last.status)) {
    await app.db.update(paymentAttempts).set({ status: "cancelled", failureReason: "Superseded by a new attempt" }).where(eq(paymentAttempts.id, last.id));
  }
  const snap = order.snapshot as { package?: { name?: string }; quote?: { dueNowMinor?: number } };
  const { redirect } = await startPayment(app, {
    organizationId: order.organizationId,
    orderId: order.id,
    purpose: "checkout",
    amountMinor: snap.quote?.dueNowMinor ?? order.depositMinor,
    description: `${snap.package?.name ?? "Order"} (${order.reference})`,
    customer: { name: order.billingDetails.name, email: order.billingDetails.email },
    provider,
    createdById: order.userId,
    returnPath: `/checkout/return?order=${order.reference}&token=${orderAccessToken(app.config.APP_SECRET, order.reference)}`,
  });
  return { orderId: order.id, orderReference: order.reference, accessToken: orderAccessToken(app.config.APP_SECRET, order.reference), payment: redirect };
}

export function webhookRoutes(app: AppContext): RouteDef[] {
  const limit = limits.webhook();
  return [
    defineRoute({
      method: "post",
      path: "/webhooks/payments/:provider",
      summary: "Provider payment notifications (PayFast ITN / Yoco webhooks). Signature-verified, reconciled and idempotent.",
      tags: ["webhooks"],
      auth: "public",
      csrfExempt: true,
      params: z.object({ provider: z.enum(["payfast", "yoco"]) }),
      middleware: [limit],
      handler: async ({ params, req, res }) => {
        const adapter = app.payments.get(params.provider);
        if (!adapter || !adapter.configured()) {
          res.status(404).end();
          return;
        }
        const verification = await adapter.verifyWebhook({ rawBody: req.rawBody ?? Buffer.alloc(0), headers: req.headers, ip: req.ip });
        if (!verification.ok) {
          await recordWebhookEvent(app, params.provider, {
            eventId: `rejected:${verification.eventId ?? randomToken(8)}:${Date.now()}`,
            eventType: "rejected",
            reference: null,
            signatureValid: false,
            payload: verification.redacted,
            sourceIp: req.ip,
            status: "rejected",
            error: verification.reason,
          });
          req.log.warn({ provider: params.provider, reason: verification.reason }, "webhook rejected");
          res.status(400).json({ ok: false });
          return;
        }
        const result = await processVerifiedEvent(app, params.provider, verification.event, req);
        // Acknowledge processed/duplicate/ignored events so providers stop retrying; 500 on internal failure so they retry.
        res.status(result.status === "failed" ? 500 : 200).json({ ok: result.status !== "failed", status: result.status });
      },
    }),
  ];
}

// ---------------------------------------------------------------- portal finance
export function portalFinanceRoutes(app: AppContext): RouteDef[] {
  async function clientInvoice(userId: string, id: string) {
    const [inv] = await app.db.select().from(invoices).where(eq(invoices.id, id));
    if (!inv || inv.status === "draft") throw notFound("Invoice");
    await assertOrgAccess(app.db, userId, inv.organizationId, "Invoice");
    return inv;
  }
  const invoiceView = (inv: typeof invoices.$inferSelect) => ({
    id: inv.id,
    number: inv.number,
    kind: inv.kind,
    status: inv.status,
    overdue: isOverdue(inv),
    lines: inv.lines,
    subtotalMinor: inv.subtotalMinor,
    taxMinor: inv.taxMinor,
    taxLabel: inv.taxSnapshot.enabled ? inv.taxSnapshot.label : null,
    totalMinor: inv.totalMinor,
    amountPaidMinor: inv.amountPaidMinor,
    amountRefundedMinor: inv.amountRefundedMinor,
    balanceMinor: invoiceBalance(inv),
    issuedAt: inv.issuedAt,
    dueAt: inv.dueAt,
    paidAt: inv.paidAt,
    orderId: inv.orderId,
    projectId: inv.projectId,
    eft: (inv.issuerSnapshot as { eft?: Record<string, string> }).eft ?? null,
  });
  return [
    defineRoute({
      method: "get",
      path: "/portal/orders",
      summary: "My orders",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        const rows = await app.db.select().from(orders).where(inArray(orders.organizationId, orgIds)).orderBy(desc(orders.createdAt));
        return rows.map((o) => ({ id: o.id, reference: o.reference, source: o.source, status: o.status, totalMinor: o.totalMinor, depositMinor: o.depositMinor, createdAt: o.createdAt, title: (o.snapshot as { package?: { name?: string }; proposal?: { title?: string } }).package?.name ?? (o.snapshot as { proposal?: { title?: string } }).proposal?.title ?? o.reference }));
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/orders/:id",
      summary: "Order detail with items, invoices and payment status",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      handler: async ({ params, auth }) => {
        const a = requireVerifiedClient(auth);
        const [o] = await app.db.select().from(orders).where(eq(orders.id, params.id));
        if (!o) throw notFound("Order");
        await assertOrgAccess(app.db, a.user.id, o.organizationId, "Order");
        const [items, invs, project] = await Promise.all([
          app.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
          app.db.select().from(invoices).where(eq(invoices.orderId, o.id)).orderBy(invoices.createdAt),
          app.db.select({ id: projects.id, name: projects.name, status: projects.status }).from(projects).where(eq(projects.orderId, o.id)),
        ]);
        return {
          order: { id: o.id, reference: o.reference, status: o.status, source: o.source, totalMinor: o.totalMinor, subtotalMinor: o.subtotalMinor, taxMinor: o.taxMinor, depositMinor: o.depositMinor, createdAt: o.createdAt, termsVersion: o.termsVersion, snapshot: o.snapshot, accessToken: orderAccessToken(app.config.APP_SECRET, o.reference) },
          items,
          invoices: invs.map(invoiceView),
          project: project[0] ?? null,
          status: await orderStatusView(app, o),
        };
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/invoices",
      summary: "My invoices with balances",
      tags: ["portal"],
      auth: "user",
      handler: async ({ auth }) => {
        const a = requireVerifiedClient(auth);
        const orgIds = await userOrganizationIds(app.db, a.user.id);
        if (!orgIds.length) return [];
        const rows = await app.db.select().from(invoices).where(and(inArray(invoices.organizationId, orgIds), sql`${invoices.status} <> 'draft'`)).orderBy(desc(invoices.issuedAt));
        return rows.map(invoiceView);
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/invoices/:id",
      summary: "Invoice detail with payment history",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      handler: async ({ params, auth }) => {
        const a = requireVerifiedClient(auth);
        const inv = await clientInvoice(a.user.id, params.id);
        const [payments, attempts] = await Promise.all([
          app.db
            .select({ id: paymentTransactions.id, provider: paymentTransactions.provider, amountMinor: paymentTransactions.amountMinor, refundedMinor: paymentTransactions.refundedMinor, verifiedAt: paymentTransactions.verifiedAt })
            .from(paymentTransactions)
            .where(eq(paymentTransactions.invoiceId, inv.id)),
          app.db
            .select({ id: paymentAttempts.id, reference: paymentAttempts.reference, provider: paymentAttempts.provider, status: paymentAttempts.status, amountMinor: paymentAttempts.amountMinor, createdAt: paymentAttempts.createdAt, failureReason: paymentAttempts.failureReason })
            .from(paymentAttempts)
            .where(eq(paymentAttempts.invoiceId, inv.id))
            .orderBy(desc(paymentAttempts.createdAt)),
        ]);
        return { invoice: invoiceView(inv), payments, attempts };
      },
    }),
    defineRoute({
      method: "post",
      path: "/portal/invoices/:id/pay",
      summary: "Start paying an invoice's outstanding balance",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      body: z.object({ provider: z.enum(["payfast", "yoco", "eft"]).optional() }),
      handler: async ({ params, body, auth }) => {
        const a = requireVerifiedClient(auth);
        const inv = await clientInvoice(a.user.id, params.id);
        if (!["issued", "partially_paid"].includes(inv.status)) throw conflict("This invoice is not payable.");
        const balance = invoiceBalance(inv);
        if (balance <= 0) throw conflict("This invoice is already settled.");
        const open = await app.db
          .select()
          .from(paymentAttempts)
          .where(and(eq(paymentAttempts.invoiceId, inv.id), eq(paymentAttempts.status, "pending_verification")));
        if (open.length) throw conflict("A payment for this invoice is awaiting verification.");
        await app.db
          .update(paymentAttempts)
          .set({ status: "cancelled", failureReason: "Superseded by a new attempt" })
          .where(and(eq(paymentAttempts.invoiceId, inv.id), inArray(paymentAttempts.status, ["created", "redirected"])));
        const provider = await resolveProvider(app, body.provider);
        const { redirect } = await startPayment(app, {
          organizationId: inv.organizationId,
          invoiceId: inv.id,
          orderId: inv.orderId,
          purpose: "invoice",
          amountMinor: balance,
          description: `Invoice ${inv.number}`,
          customer: { name: a.user.name, email: a.user.email },
          provider,
          createdById: a.user.id,
          returnPath: `/portal/invoices/${inv.id}`,
        });
        return redirect;
      },
    }),
    defineRoute({
      method: "get",
      path: "/portal/invoices/:id/pdf",
      summary: "Download an invoice PDF",
      tags: ["portal"],
      auth: "user",
      params: idParams,
      rawResponse: { contentType: "application/pdf" },
      handler: async ({ params, auth, res }) => {
        const a = requireVerifiedClient(auth);
        const inv = await clientInvoice(a.user.id, params.id);
        res.type("application/pdf").setHeader("content-disposition", `attachment; filename="${inv.number}.pdf"`);
        res.send(await renderInvoicePdf(inv));
      },
    }),
  ];
}

// ---------------------------------------------------------------- admin finance
export function adminFinanceRoutes(app: AppContext): RouteDef[] {
  return [
    defineRoute({
      method: "get",
      path: "/admin/orders",
      summary: "Orders",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "orders.read",
      query: paginationQuery.extend({ status: z.string().max(30).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ o: orders, orgName: organizations.name })
          .from(orders)
          .innerJoin(organizations, eq(organizations.id, orders.organizationId))
          .where(
            and(
              query.status ? eq(orders.status, query.status as never) : undefined,
              query.q ? or(ilike(orders.reference, likePattern(query.q)), ilike(organizations.name, likePattern(query.q))) : undefined,
              cursorWhere(orders.createdAt, orders.id, query.cursor),
            ),
          )
          .orderBy(...cursorOrder(orders.createdAt, orders.id))
          .limit(query.limit + 1);
        return pageOf(
          rows.map((r) => ({ id: r.o.id, createdAt: r.o.createdAt, reference: r.o.reference, status: r.o.status, source: r.o.source, totalMinor: r.o.totalMinor, depositMinor: r.o.depositMinor, client: r.orgName, title: (r.o.snapshot as { package?: { name?: string }; proposal?: { title?: string } }).package?.name ?? (r.o.snapshot as { proposal?: { title?: string } }).proposal?.title ?? "" })),
          query.limit,
        );
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/orders/:id",
      summary: "Order with items, attempts, transactions, invoices and project",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "orders.read",
      params: idParams,
      handler: async ({ params }) => {
        const [o] = await app.db.select().from(orders).where(eq(orders.id, params.id));
        if (!o) throw notFound("Order");
        const [items, attempts, invs, project, org] = await Promise.all([
          app.db.select().from(orderItems).where(eq(orderItems.orderId, o.id)),
          app.db.select().from(paymentAttempts).where(eq(paymentAttempts.orderId, o.id)).orderBy(desc(paymentAttempts.createdAt)),
          app.db.select().from(invoices).where(eq(invoices.orderId, o.id)),
          app.db.select().from(projects).where(eq(projects.orderId, o.id)),
          app.db.select().from(organizations).where(eq(organizations.id, o.organizationId)),
        ]);
        const txns = invs.length ? await app.db.select().from(paymentTransactions).where(inArray(paymentTransactions.invoiceId, invs.map((i) => i.id))) : [];
        return { order: o, organization: org[0], items, attempts, invoices: invs.map((i) => ({ ...i, balanceMinor: invoiceBalance(i), overdue: isOverdue(i) })), transactions: txns, project: project[0] ?? null };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/orders/:id/cancel",
      summary: "Cancel an order (unpaid, or with an audited reason)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "orders.manage",
      params: idParams,
      body: z.object({ reason: z.string().trim().min(5).max(1000) }),
      handler: async ({ params, body, req }) => {
        return app.db.transaction(async (tx) => {
          const [o] = await tx.select().from(orders).where(eq(orders.id, params.id));
          if (!o) throw notFound("Order");
          if (!orderMachine.can(o.status, "cancelled")) throw new AppError(422, "invalid_transition", `An order that is ${o.status.replace("_", " ")} can't be cancelled.`);
          await tx.update(orders).set({ status: "cancelled", cancelledAt: new Date(), notes: `${o.notes}\nCancelled: ${body.reason}`.trim() }).where(eq(orders.id, o.id));
          await tx.update(paymentAttempts).set({ status: "cancelled", failureReason: "Order cancelled" }).where(and(eq(paymentAttempts.orderId, o.id), inArray(paymentAttempts.status, ["created", "redirected"])));
          await audit(tx, req, { action: "order.cancelled", entityType: "order", entityId: o.id, reason: body.reason, before: { status: o.status } });
          return { ok: true as const };
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/invoices",
      summary: "Invoices (filter by status or overdue)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "invoices.read",
      query: paginationQuery.extend({ status: z.string().max(30).optional(), overdue: z.enum(["true"]).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ i: invoices, orgName: organizations.name })
          .from(invoices)
          .innerJoin(organizations, eq(organizations.id, invoices.organizationId))
          .where(
            and(
              query.status ? eq(invoices.status, query.status as never) : undefined,
              query.overdue ? and(inArray(invoices.status, ["issued", "partially_paid"]), lt(invoices.dueAt, new Date())) : undefined,
              query.q ? or(ilike(invoices.number, likePattern(query.q)), ilike(organizations.name, likePattern(query.q))) : undefined,
              cursorWhere(invoices.createdAt, invoices.id, query.cursor),
            ),
          )
          .orderBy(...cursorOrder(invoices.createdAt, invoices.id))
          .limit(query.limit + 1);
        return pageOf(rows.map((r) => ({ ...r.i, client: r.orgName, balanceMinor: invoiceBalance(r.i), overdue: isOverdue(r.i) })), query.limit);
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/invoices/:id",
      summary: "Invoice with transactions, attempts, refunds and credit notes",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "invoices.read",
      params: idParams,
      handler: async ({ params }) => {
        const [inv] = await app.db.select().from(invoices).where(eq(invoices.id, params.id));
        if (!inv) throw notFound("Invoice");
        const [txns, attempts, notes, org] = await Promise.all([
          app.db.select().from(paymentTransactions).where(eq(paymentTransactions.invoiceId, inv.id)),
          app.db.select().from(paymentAttempts).where(eq(paymentAttempts.invoiceId, inv.id)).orderBy(desc(paymentAttempts.createdAt)),
          app.db.select().from(creditNotes).where(eq(creditNotes.invoiceId, inv.id)),
          app.db.select().from(organizations).where(eq(organizations.id, inv.organizationId)),
        ]);
        const refundRows = txns.length ? await app.db.select().from(refunds).where(inArray(refunds.transactionId, txns.map((t) => t.id))) : [];
        return { invoice: { ...inv, balanceMinor: invoiceBalance(inv), overdue: isOverdue(inv) }, organization: org[0], transactions: txns, attempts, refunds: refundRows, creditNotes: notes };
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/invoices",
      summary: "Issue a manual invoice (retainer, milestone, other)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "invoices.manage",
      body: invoiceCreateBody,
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        const inv = await app.db.transaction(async (tx) => {
          const [org] = await tx.select().from(organizations).where(eq(organizations.id, body.organizationId));
          if (!org) throw notFound("Organisation");
          const i = await issueInvoice(app, tx, { organizationId: body.organizationId, orderId: body.orderId, projectId: body.projectId, milestoneId: body.milestoneId, kind: body.kind, amounts: { mode: "net", lines: body.lines }, dueInDays: body.dueInDays, notes: body.notes, createdById: a.user.id });
          await audit(tx, req, { action: "invoice.issued", entityType: "invoice", entityId: i.id, after: { number: i.number, totalMinor: i.totalMinor } });
          const [member] = await tx.execute<{ user_id: string }>(sql`select user_id from organization_members where organization_id = ${body.organizationId} order by created_at limit 1`).then((r) => r.rows);
          if (member) {
            await app.notifications.queue(tx, { template: "invoice.issued", userId: member.user_id, category: "invoices", data: { number: i.number, amountMinor: i.totalMinor, description: body.lines[0].description, dueDate: i.dueAt?.toISOString().slice(0, 10), path: `/portal/invoices/${i.id}` }, dedupeKey: `invoice-issued:${i.id}` });
          }
          return i;
        });
        void app.notifications.dispatchPending();
        return inv;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/invoices/:id/void",
      summary: "Void an unpaid invoice (requires reason; audited)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "invoices.manage",
      params: idParams,
      body: invoiceVoidBody,
      handler: async ({ params, body, req }) => {
        return app.db.transaction(async (tx) => {
          const [inv] = await tx.select().from(invoices).where(eq(invoices.id, params.id));
          if (!inv) throw notFound("Invoice");
          if (inv.amountPaidMinor > 0) throw new AppError(422, "invalid_transition", "Invoices with payments can't be voided — refund and issue a credit note instead.");
          if (!invoiceMachine.can(inv.status, "void")) throw new AppError(422, "invalid_transition", "This invoice can't be voided.");
          await tx.update(invoices).set({ status: "void", voidedAt: new Date(), voidReason: body.reason }).where(eq(invoices.id, inv.id));
          await tx.update(paymentAttempts).set({ status: "cancelled", failureReason: "Invoice voided" }).where(and(eq(paymentAttempts.invoiceId, inv.id), inArray(paymentAttempts.status, ["created", "redirected", "pending_verification"])));
          await audit(tx, req, { action: "invoice.voided", entityType: "invoice", entityId: inv.id, reason: body.reason, before: { status: inv.status } });
          return { ok: true as const };
        });
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/invoices/:id/pdf",
      summary: "Invoice PDF",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "invoices.read",
      params: idParams,
      rawResponse: { contentType: "application/pdf" },
      handler: async ({ params, res }) => {
        const [inv] = await app.db.select().from(invoices).where(eq(invoices.id, params.id));
        if (!inv) throw notFound("Invoice");
        res.type("application/pdf").setHeader("content-disposition", `inline; filename="${inv.number}.pdf"`);
        res.send(await renderInvoicePdf(inv));
      },
    }),
    // ------------------------------------------------------------ payments & reconciliation
    defineRoute({
      method: "get",
      path: "/admin/payments",
      summary: "Verified payment transactions",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.read",
      query: paginationQuery,
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ t: paymentTransactions, orgName: organizations.name, invoiceNumber: invoices.number })
          .from(paymentTransactions)
          .innerJoin(organizations, eq(organizations.id, paymentTransactions.organizationId))
          .leftJoin(invoices, eq(invoices.id, paymentTransactions.invoiceId))
          .where(and(query.q ? or(ilike(paymentTransactions.providerTransactionId, likePattern(query.q)), ilike(organizations.name, likePattern(query.q))) : undefined, cursorWhere(paymentTransactions.createdAt, paymentTransactions.id, query.cursor)))
          .orderBy(...cursorOrder(paymentTransactions.createdAt, paymentTransactions.id))
          .limit(query.limit + 1);
        return pageOf(rows.map((r) => ({ ...r.t, client: r.orgName, invoiceNumber: r.invoiceNumber, refundableMinor: r.t.amountMinor - r.t.refundedMinor })), query.limit);
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/payment-attempts",
      summary: "Payment attempts (e.g. EFT awaiting verification, failures)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.read",
      query: paginationQuery.extend({ status: z.string().max(30).optional() }),
      handler: async ({ query }) => {
        const rows = await app.db
          .select({ a: paymentAttempts, orgName: organizations.name })
          .from(paymentAttempts)
          .innerJoin(organizations, eq(organizations.id, paymentAttempts.organizationId))
          .where(and(query.status ? eq(paymentAttempts.status, query.status as never) : undefined, query.q ? ilike(paymentAttempts.reference, likePattern(query.q)) : undefined, cursorWhere(paymentAttempts.createdAt, paymentAttempts.id, query.cursor)))
          .orderBy(...cursorOrder(paymentAttempts.createdAt, paymentAttempts.id))
          .limit(query.limit + 1);
        return pageOf(rows.map((r) => ({ ...r.a, client: r.orgName })), query.limit);
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/webhook-events",
      summary: "Provider webhook log (redacted)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.read",
      query: paginationQuery,
      handler: async ({ query }) => {
        const rows = await app.db
          .select()
          .from(webhookEvents)
          .where(cursorWhere(webhookEvents.receivedAt, webhookEvents.id, query.cursor))
          .orderBy(desc(webhookEvents.receivedAt), desc(webhookEvents.id))
          .limit(query.limit + 1);
        return pageOf(rows.map((r) => ({ ...r, createdAt: r.receivedAt })), query.limit);
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/payments/offline",
      summary: "Confirm an EFT / offline payment once funds have cleared (audited)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.confirm_offline",
      body: offlinePaymentBody.extend({ invoiceId: z.uuid().optional() }),
      successStatus: 201,
      handler: async ({ body, auth, req }) => {
        const a = requireUser(auth);
        if (!body.attemptId && !body.invoiceId) throw new AppError(422, "validation_failed", "Specify the EFT payment attempt or the invoice.");
        const result = await app.db.transaction(async (tx) => {
          let attemptId = body.attemptId;
          if (!attemptId) {
            const [inv] = await tx.select().from(invoices).where(eq(invoices.id, body.invoiceId!));
            if (!inv || !["issued", "partially_paid"].includes(inv.status)) throw new AppError(422, "invalid_transition", "This invoice is not payable.");
            if (body.amountMinor > invoiceBalance(inv)) throw new AppError(422, "validation_failed", "Amount exceeds the invoice balance.");
            const reference = await nextNumber(tx, "PAY", new Date(), 6);
            const [att] = await tx
              .insert(paymentAttempts)
              .values({ reference, organizationId: inv.organizationId, invoiceId: inv.id, orderId: inv.orderId, provider: "eft", purpose: "invoice", amountMinor: body.amountMinor, idempotencyKey: `offline:${reference}`, createdById: null, status: "pending_verification" })
              .returning();
            attemptId = att.id;
          }
          const locked = await tx.execute<{ id: string }>(sql`select id from payment_attempts where id = ${attemptId} for update`);
          if (!locked.rows[0]) throw notFound("Payment attempt");
          const [attempt] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, attemptId));
          if (attempt.provider !== "eft") throw new AppError(422, "unprocessable", "Only EFT attempts can be confirmed manually.");
          if (body.amountMinor !== attempt.amountMinor) throw new AppError(422, "validation_failed", `Received amount must equal the expected ${attempt.amountMinor / 100} ZAR. Record a different amount against the invoice instead.`);
          const r = await applySuccessfulPayment(app, tx, attempt, {
            provider: "eft",
            providerTransactionId: `eft:${body.bankReference}`,
            amountMinor: body.amountMinor,
            feeMinor: null,
            verificationMethod: "manual_eft",
            raw: { bankReference: body.bankReference, receivedAt: body.receivedAt, note: body.note },
            verifiedById: a.user.id,
          }, req);
          if (r.status === "duplicate") throw conflict("This bank reference has already been recorded.");
          return r;
        });
        void app.notifications.dispatchPending();
        return result;
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/payments/:id/refunds",
      summary: "Refund (part of) a verified transaction — requires reason, links the original transaction, audited",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.refund",
      params: idParams,
      body: refundBody,
      successStatus: 201,
      handler: async ({ params, body, auth, req }) => {
        const a = requireUser(auth);
        const prepared = await app.db.transaction(async (tx) => {
          const locked = await tx.execute<{ id: string }>(sql`select id from payment_transactions where id = ${params.id} for update`);
          if (!locked.rows[0]) throw notFound("Transaction");
          const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, params.id));
          const [existing] = await tx.select().from(refunds).where(eq(refunds.idempotencyKey, body.idempotencyKey));
          if (existing) return { refund: existing, txn, replay: true };
          const pending = await tx
            .select({ total: sql<number>`coalesce(sum(${refunds.amountMinor}),0)` })
            .from(refunds)
            .where(and(eq(refunds.transactionId, txn.id), inArray(refunds.status, ["pending", "manual_pending"])));
          const refundable = txn.amountMinor - txn.refundedMinor - Number(pending[0].total);
          if (body.amountMinor > refundable) throw new AppError(422, "validation_failed", `At most ${refundable / 100} ZAR can still be refunded on this transaction.`);
          const [refund] = await tx
            .insert(refunds)
            .values({ transactionId: txn.id, invoiceId: txn.invoiceId, amountMinor: body.amountMinor, reason: body.reason, idempotencyKey: body.idempotencyKey, createdById: a.user.id, status: "pending" })
            .returning();
          await audit(tx, req, { action: "refund.requested", entityType: "refund", entityId: refund.id, reason: body.reason, after: { transactionId: txn.id, amountMinor: body.amountMinor } });
          return { refund, txn, replay: false };
        });
        if (prepared.replay) return prepared.refund;
        const adapter = app.payments.get(prepared.txn.provider);
        let status: "succeeded" | "pending" | "failed" | "manual_pending" = "manual_pending";
        let providerRefundId: string | null = null;
        let failureReason: string | null = null;
        if (adapter?.supportsRefunds && adapter.refund) {
          const [attempt] = prepared.txn.attemptId ? await app.db.select().from(paymentAttempts).where(eq(paymentAttempts.id, prepared.txn.attemptId)) : [null];
          try {
            const r = await adapter.refund({ providerCheckoutId: attempt?.providerCheckoutId ?? null, providerTransactionId: prepared.txn.providerTransactionId, amountMinor: prepared.refund.amountMinor, idempotencyKey: prepared.refund.idempotencyKey });
            status = r.status;
            providerRefundId = r.providerRefundId;
            failureReason = r.failureReason ?? null;
          } catch (e) {
            status = "failed";
            failureReason = (e as Error).message;
          }
        }
        return app.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(refunds)
            .set({ status, providerRefundId, failureReason, completedAt: status === "succeeded" ? new Date() : null })
            .where(eq(refunds.id, prepared.refund.id))
            .returning();
          if (status === "succeeded") await applyRefundCompletion(app, tx, updated.id, req);
          await audit(tx, req, { action: `refund.${status}`, entityType: "refund", entityId: updated.id, after: { providerRefundId, failureReason } });
          return updated;
        }).finally(() => void app.notifications.dispatchPending());
      },
    }),
    defineRoute({
      method: "post",
      path: "/admin/refunds/:id/complete",
      summary: "Mark a manual refund as paid out (e.g. EFT back to the client)",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.refund",
      params: idParams,
      body: z.object({ payoutReference: z.string().trim().min(2).max(120) }),
      handler: async ({ params, body, req }) => {
        const r = await app.db.transaction(async (tx) => {
          const [refund] = await tx.select().from(refunds).where(eq(refunds.id, params.id));
          if (!refund) throw notFound("Refund");
          if (refund.status !== "manual_pending" && refund.status !== "pending") throw conflict("This refund is already completed or failed.");
          const [u] = await tx.update(refunds).set({ status: "manual_completed", providerRefundId: body.payoutReference, completedAt: new Date() }).where(eq(refunds.id, refund.id)).returning();
          await applyRefundCompletion(app, tx, refund.id, req);
          return u;
        });
        void app.notifications.dispatchPending();
        return r;
      },
    }),
    defineRoute({
      method: "get",
      path: "/admin/refunds",
      summary: "Refunds",
      tags: ["admin:finance"],
      auth: "staff",
      permission: "payments.read",
      handler: async () =>
        app.db
          .select({ r: refunds, requestedBy: users.name })
          .from(refunds)
          .leftJoin(users, eq(users.id, refunds.createdById))
          .orderBy(desc(refunds.createdAt))
          .limit(200)
          .then((rows) => rows.map((x) => ({ ...x.r, requestedBy: x.requestedBy }))),
    }),
  ];
}

void isNotNull;
