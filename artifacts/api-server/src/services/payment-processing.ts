import { and, eq, sql } from "drizzle-orm";
import {
  creditNotes,
  invoices,
  leadActivities,
  leads,
  milestones,
  orders,
  paymentAttempts,
  paymentTransactions,
  projects,
  refunds,
  users,
  webhookEvents,
  type DbOrTx,
  type PaymentProvider,
} from "@workspace/db";
import { invoiceMachine, orderMachine, paymentAttemptMachine, type PaymentAttemptStatus } from "@workspace/domain";
import { addDays, nextNumber } from "../lib/db-helpers";
import { audit, track } from "./audit";
import { createAuthToken } from "./accounts";
import { issueInvoice } from "./invoicing";
import type { VerifiedPaymentEvent } from "./payments";
import type { AppContext } from "../context";

type Attempt = typeof paymentAttempts.$inferSelect;
type Req = Parameters<typeof audit>[1];

export interface ProcessResult {
  status: "processed" | "ignored" | "duplicate" | "rejected" | "failed";
  detail: string;
}

/**
 * Record a provider event exactly once. Returns the webhook_events row id, or null
 * when this (provider, eventId) was already processed (duplicate delivery).
 */
export async function recordWebhookEvent(
  app: AppContext,
  provider: PaymentProvider,
  ev: { eventId: string; eventType: string; reference: string | null; signatureValid: boolean; payload: Record<string, unknown>; sourceIp?: string | null; status?: "received" | "rejected"; error?: string | null },
): Promise<{ id: string; duplicate: boolean }> {
  const rows = await app.db
    .insert(webhookEvents)
    .values({
      provider,
      eventId: ev.eventId,
      eventType: ev.eventType,
      providerReference: ev.reference,
      signatureValid: ev.signatureValid,
      processingStatus: ev.status ?? "received",
      error: ev.error ?? null,
      payloadRedacted: ev.payload,
      sourceIp: ev.sourceIp ?? null,
    })
    .onConflictDoUpdate({
      target: [webhookEvents.provider, webhookEvents.eventId],
      set: { retryCount: sql`${webhookEvents.retryCount} + 1` },
    })
    .returning({ id: webhookEvents.id, status: webhookEvents.processingStatus, retryCount: webhookEvents.retryCount });
  const row = rows[0];
  const duplicate = row.retryCount > 0 && ["processed", "ignored"].includes(row.status);
  return { id: row.id, duplicate };
}

async function finishWebhook(app: AppContext, id: string, result: ProcessResult) {
  await app.db
    .update(webhookEvents)
    .set({
      processingStatus: result.status === "processed" ? "processed" : result.status === "rejected" ? "rejected" : result.status === "failed" ? "failed" : "ignored",
      result: result.detail.slice(0, 500),
      processedAt: new Date(),
    })
    .where(eq(webhookEvents.id, id));
}

async function lockAttempt(tx: DbOrTx, where: { reference?: string | null; providerCheckoutId?: string | null; id?: string }): Promise<Attempt | null> {
  let cond;
  if (where.id) cond = sql`id = ${where.id}`;
  else if (where.reference) cond = sql`reference = ${where.reference}`;
  else if (where.providerCheckoutId) cond = sql`provider_checkout_id = ${where.providerCheckoutId}`;
  else return null;
  const locked = await tx.execute<{ id: string }>(sql`select id from payment_attempts where ${cond} for update`);
  const id = locked.rows[0]?.id;
  if (!id) return null;
  const [a] = await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, id));
  return a ?? null;
}

async function setAttemptStatus(tx: DbOrTx, attempt: Attempt, to: PaymentAttemptStatus, extra: Partial<typeof paymentAttempts.$inferInsert> = {}) {
  if (attempt.status === to) return;
  paymentAttemptMachine.assert(attempt.status, to);
  await tx.update(paymentAttempts).set({ status: to, ...extra }).where(eq(paymentAttempts.id, attempt.id));
}

/** Process a verified gateway event end-to-end (idempotent). */
export async function processVerifiedEvent(app: AppContext, provider: PaymentProvider, event: VerifiedPaymentEvent, req: Req): Promise<ProcessResult> {
  const recorded = await recordWebhookEvent(app, provider, {
    eventId: event.eventId,
    eventType: event.eventType,
    reference: event.reference,
    signatureValid: true,
    payload: event.redacted,
    sourceIp: (req as { ip?: string } | null)?.ip ?? null,
  });
  if (recorded.duplicate) return { status: "duplicate", detail: "event already processed" };

  let result: ProcessResult;
  try {
    result = await app.db.transaction(async (tx) => {
      if (event.outcome === "refunded") return { status: "ignored", detail: "refund notifications are reconciled via the refunds workflow" } as ProcessResult;
      if (event.outcome === "ignored") return { status: "ignored", detail: `unhandled event type ${event.eventType}` } as ProcessResult;
      const attempt = await lockAttempt(tx, { reference: event.reference, providerCheckoutId: event.providerCheckoutId });
      if (!attempt) return { status: "rejected", detail: "unknown payment reference" } as ProcessResult;
      if (attempt.provider !== provider) return { status: "rejected", detail: "provider mismatch" } as ProcessResult;

      if (event.outcome === "succeeded") {
        if (event.amountMinor !== attempt.amountMinor) {
          await audit(tx, req, { action: "payment.amount_mismatch", entityType: "payment_attempt", entityId: attempt.id, after: { expected: attempt.amountMinor, received: event.amountMinor } });
          return { status: "rejected", detail: `amount mismatch: expected ${attempt.amountMinor}, received ${event.amountMinor}` } as ProcessResult;
        }
        if (event.currency && event.currency.toUpperCase() !== attempt.currency) {
          return { status: "rejected", detail: `currency mismatch: ${event.currency}` } as ProcessResult;
        }
        if (!event.providerTransactionId) return { status: "rejected", detail: "missing provider transaction id" } as ProcessResult;
        const applied = await applySuccessfulPayment(app, tx, attempt, {
          provider,
          providerTransactionId: event.providerTransactionId,
          amountMinor: event.amountMinor,
          feeMinor: event.feeMinor,
          verificationMethod: "webhook",
          raw: event.redacted,
          verifiedById: null,
        }, req);
        return applied;
      }

      if (event.outcome === "pending") {
        if (["created", "redirected"].includes(attempt.status)) await setAttemptStatus(tx, attempt, "pending_verification");
        return { status: "processed", detail: "payment pending at provider" } as ProcessResult;
      }

      // failed / cancelled: never downgrade a succeeded attempt (out-of-order delivery).
      if (attempt.status === "succeeded") return { status: "ignored", detail: "attempt already succeeded" } as ProcessResult;
      const to = event.outcome === "failed" ? "failed" : "cancelled";
      await setAttemptStatus(tx, attempt, to, { failureReason: event.failureReason, completedAt: new Date() });
      await track(tx, "payment_failed", { entityType: "payment_attempt", entityId: attempt.id, properties: { provider, outcome: to } });
      if (attempt.createdById) {
        const retryPath = attempt.invoiceId ? `/portal/invoices/${attempt.invoiceId}` : `/portal/orders/${attempt.orderId}`;
        await app.notifications.queue(tx, {
          template: "payment.failed",
          userId: attempt.createdById,
          channels: ["email", "in_app"],
          data: { description: attempt.reference, reason: event.failureReason, path: retryPath },
          dedupeKey: `payment-failed:${attempt.id}`,
        });
      }
      return { status: "processed", detail: `attempt marked ${to}` } as ProcessResult;
    });
  } catch (err) {
    app.logger.error({ err, provider, eventId: event.eventId }, "payment event processing failed");
    result = { status: "failed", detail: (err as Error).message };
  }
  await finishWebhook(app, recorded.id, result);
  if (result.status === "processed") void app.notifications.dispatchPending();
  return result;
}

export interface SuccessfulPayment {
  provider: PaymentProvider;
  providerTransactionId: string;
  amountMinor: number;
  feeMinor: number | null;
  verificationMethod: "webhook" | "api_reconciliation" | "manual_eft";
  raw: Record<string, unknown>;
  verifiedById: string | null;
}

/**
 * Apply a verified payment to its attempt, order and/or invoice. Must run inside a
 * transaction holding the attempt row lock. Duplicate provider transaction ids are no-ops.
 */
export async function applySuccessfulPayment(app: AppContext, tx: DbOrTx, attempt: Attempt, pay: SuccessfulPayment, req: Req): Promise<ProcessResult> {
  if (attempt.status === "succeeded") return { status: "duplicate", detail: "attempt already succeeded" };
  const now = new Date();
  const inserted = await tx
    .insert(paymentTransactions)
    .values({
      attemptId: attempt.id,
      invoiceId: attempt.invoiceId,
      organizationId: attempt.organizationId,
      provider: pay.provider,
      providerTransactionId: pay.providerTransactionId,
      amountMinor: pay.amountMinor,
      feeMinor: pay.feeMinor,
      netMinor: pay.feeMinor !== null ? pay.amountMinor - pay.feeMinor : null,
      verifiedAt: now,
      verifiedById: pay.verifiedById,
      verificationMethod: pay.verificationMethod,
      rawRedacted: pay.raw,
    })
    .onConflictDoNothing()
    .returning();
  if (!inserted[0]) return { status: "duplicate", detail: "transaction already recorded" };
  const txn = inserted[0];
  await setAttemptStatus(tx, attempt, "succeeded", { completedAt: now, failureReason: null });

  let invoiceId = attempt.invoiceId;
  let invoiceNumber = "";
  let orderReference = "";
  let description = attempt.reference;

  if (attempt.purpose === "checkout" && attempt.orderId) {
    const [order] = await tx.select().from(orders).where(eq(orders.id, attempt.orderId));
    orderReference = order.reference;
    const snap = order.snapshot as { package?: { name?: string; isDiscovery?: boolean }; quote?: { balanceMinor?: number } };
    description = snap.package?.name ?? order.reference;
    if (order.status === "pending_payment") {
      orderMachine.assert(order.status, "confirmed");
      await tx.update(orders).set({ status: "confirmed", confirmedAt: now }).where(eq(orders.id, order.id));
    }
    const isFull = pay.amountMinor >= order.totalMinor;
    const inv = await issueInvoice(app, tx, {
      organizationId: order.organizationId,
      orderId: order.id,
      kind: snap.package?.isDiscovery ? "discovery" : isFull ? "full" : "deposit",
      amounts: { mode: "gross", description: `${isFull ? "" : "Deposit — "}${description} (${order.reference})`, grossMinor: pay.amountMinor },
      paidAt: now,
      createdById: null,
    });
    invoiceId = inv.id;
    invoiceNumber = inv.number;
    await tx.update(paymentTransactions).set({ invoiceId: inv.id }).where(eq(paymentTransactions.id, txn.id));
    await tx.update(paymentAttempts).set({ invoiceId: inv.id }).where(eq(paymentAttempts.id, attempt.id));

    // Create the delivery project once per order.
    const [existingProject] = await tx.select({ id: projects.id }).from(projects).where(eq(projects.orderId, order.id));
    if (!existingProject) {
      const projectRef = await nextNumber(tx, "PRJ");
      const [project] = await tx
        .insert(projects)
        .values({
          reference: projectRef,
          organizationId: order.organizationId,
          orderId: order.id,
          name: description,
          summary: `Delivery of ${description}, purchased via order ${order.reference}.`,
          status: "not_started",
          contractValueMinor: order.totalMinor,
          depositRequired: true,
          depositInvoiceId: inv.id,
          depositPaidAt: now,
        })
        .returning();
      const balance = order.totalMinor - pay.amountMinor;
      await tx.insert(milestones).values([
        { projectId: project.id, key: "kickoff", title: "Payment received & kick-off", description: "Order confirmed and scheduling agreed.", displayOrder: 0, status: "completed", completedAt: now, amountMinor: pay.amountMinor, billable: true, invoiceId: inv.id },
        { projectId: project.id, key: "delivery", title: snap.package?.isDiscovery ? "Discovery outputs delivered" : "Delivery & handover", description: "", displayOrder: 1, amountMinor: Math.max(0, balance), billable: balance > 0 },
      ]);
    }
    if (order.leadId) {
      await tx.update(leads).set({ status: "won", organizationId: order.organizationId }).where(eq(leads.id, order.leadId));
      await tx.insert(leadActivities).values({ leadId: order.leadId, type: "payment_event", body: `Payment of ${pay.amountMinor / 100} ZAR confirmed for order ${order.reference}`, metadata: { orderId: order.id, transactionId: txn.id } });
    }
    await track(tx, snap.package?.isDiscovery ? "discovery_purchased" : "payment_succeeded", { userId: order.userId, entityType: "order", entityId: order.id, properties: { amountMinor: pay.amountMinor, provider: pay.provider } });
    if (order.userId) {
      const [u] = await tx.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, order.userId));
      let path = `/portal/orders/${order.id}`;
      if (u && !u.passwordHash) path = `/auth/magic?token=${await createAuthToken(tx, order.userId, "invite")}&next=${encodeURIComponent(path)}`;
      await app.notifications.queue(tx, {
        template: "order.confirmed",
        userId: order.userId,
        data: { orderReference: order.reference, amountMinor: pay.amountMinor, description, invoiceNumber, path },
        dedupeKey: `order-confirmed:${order.id}`,
      });
    }
    await app.notifications.queueStaff(tx, {
      template: "staff.new_lead",
      data: { reference: order.reference, name: order.billingDetails.name, email: order.billingDetails.email, company: order.billingDetails.company, source: "paid order", summary: `${description} — paid ${pay.amountMinor / 100} ZAR via ${pay.provider}`, path: `/admin/orders/${order.id}` },
      dedupeKey: `order-paid-staff:${order.id}`,
    });
  } else if (attempt.invoiceId) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, attempt.invoiceId));
    invoiceNumber = inv.number;
    const paid = inv.amountPaidMinor + pay.amountMinor;
    const to = paid >= inv.totalMinor ? "paid" : "partially_paid";
    invoiceMachine.assert(inv.status, to);
    await tx.update(invoices).set({ amountPaidMinor: paid, status: to, paidAt: to === "paid" ? now : inv.paidAt }).where(eq(invoices.id, inv.id));
    if (to === "paid") {
      // Deposit invoice settled → project may start.
      const [proj] = await tx.select().from(projects).where(eq(projects.depositInvoiceId, inv.id));
      if (proj && !proj.depositPaidAt) {
        await tx.update(projects).set({ depositPaidAt: now, status: proj.status === "awaiting_deposit" ? "not_started" : proj.status }).where(eq(projects.id, proj.id));
      }
      if (inv.milestoneId) {
        const [ms] = await tx.select().from(milestones).where(eq(milestones.id, inv.milestoneId));
        if (ms && ms.key === "deposit" && ms.status === "pending") await tx.update(milestones).set({ status: "completed", completedAt: now }).where(eq(milestones.id, ms.id));
      }
      if (inv.orderId) {
        const [o] = await tx.select().from(orders).where(eq(orders.id, inv.orderId));
        if (o?.status === "pending_payment") await tx.update(orders).set({ status: "confirmed", confirmedAt: now }).where(eq(orders.id, o.id));
      }
      await track(tx, "invoice_paid", { entityType: "invoice", entityId: inv.id, properties: { amountMinor: pay.amountMinor } });
    }
    await track(tx, "payment_succeeded", { entityType: "invoice", entityId: inv.id, properties: { amountMinor: pay.amountMinor, provider: pay.provider } });
    const recipient = attempt.createdById;
    if (recipient) {
      await app.notifications.queue(tx, {
        template: "invoice.paid",
        userId: recipient,
        category: "invoices",
        data: { number: inv.number, amountMinor: pay.amountMinor, balanceMinor: Math.max(0, inv.totalMinor - paid), path: `/portal/invoices/${inv.id}` },
        dedupeKey: `invoice-paid:${txn.id}`,
      });
    }
  }

  await audit(tx, req, {
    action: pay.verificationMethod === "manual_eft" ? "payment.offline_confirmed" : "payment.succeeded",
    entityType: "payment_transaction",
    entityId: txn.id,
    after: { attempt: attempt.reference, provider: pay.provider, amountMinor: pay.amountMinor, invoiceId, orderReference, invoiceNumber, providerTransactionId: pay.providerTransactionId },
  });
  return { status: "processed", detail: `payment applied (${invoiceNumber || orderReference})` };
}

/** Apply the accounting effects of a completed refund (credit note, balances, order status). */
export async function applyRefundCompletion(app: AppContext, tx: DbOrTx, refundId: string, req: Req) {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
  const [txn] = await tx.select().from(paymentTransactions).where(eq(paymentTransactions.id, refund.transactionId));
  const refundedTotal = txn.refundedMinor + refund.amountMinor;
  await tx.update(paymentTransactions).set({ refundedMinor: refundedTotal, status: refundedTotal >= txn.amountMinor ? "reversed" : "succeeded" }).where(eq(paymentTransactions.id, txn.id));
  if (refund.invoiceId) {
    const [inv] = await tx.select().from(invoices).where(eq(invoices.id, refund.invoiceId));
    const invRefunded = inv.amountRefundedMinor + refund.amountMinor;
    const to = invRefunded >= inv.amountPaidMinor ? "refunded" : "partially_refunded";
    await tx.update(invoices).set({ amountRefundedMinor: invRefunded, status: invoiceMachine.can(inv.status, to) ? to : inv.status }).where(eq(invoices.id, inv.id));
    const number = await nextNumber(tx, "CN");
    await tx.insert(creditNotes).values({ number, invoiceId: inv.id, refundId: refund.id, amountMinor: refund.amountMinor, reason: refund.reason, createdById: refund.createdById });
    if (inv.orderId) {
      const [o] = await tx.select().from(orders).where(eq(orders.id, inv.orderId));
      const paidRows = await tx
        .select({ paid: sql<number>`coalesce(sum(${invoices.amountPaidMinor}),0)`, refunded: sql<number>`coalesce(sum(${invoices.amountRefundedMinor}),0)` })
        .from(invoices)
        .where(eq(invoices.orderId, o.id));
      const fully = Number(paidRows[0].refunded) >= Number(paidRows[0].paid);
      const target = fully ? "refunded" : "partially_refunded";
      if (o && orderMachine.can(o.status, target)) await tx.update(orders).set({ status: target }).where(eq(orders.id, o.id));
    }
  }
  const [attempt] = txn.attemptId ? await tx.select().from(paymentAttempts).where(eq(paymentAttempts.id, txn.attemptId)) : [null];
  if (attempt?.createdById) {
    await app.notifications.queue(tx, {
      template: "refund.processed",
      userId: attempt.createdById,
      data: { amountMinor: refund.amountMinor, reason: refund.reason, manual: refund.status === "manual_completed" },
      dedupeKey: `refund:${refund.id}`,
    });
  }
  await audit(tx, req, { action: "refund.completed", entityType: "refund", entityId: refund.id, after: { amountMinor: refund.amountMinor, transactionId: txn.id, status: refund.status } });
}

/** Expire abandoned gateway attempts so their orders can be retried cleanly. */
export async function expireStaleAttempts(app: AppContext, olderThanHours = 24) {
  const cutoff = addDays(new Date(), -olderThanHours / 24);
  const rows = await app.db
    .update(paymentAttempts)
    .set({ status: "expired", failureReason: "Checkout not completed" })
    .where(and(sql`${paymentAttempts.status} in ('created','redirected')`, sql`${paymentAttempts.provider} <> 'eft'`, sql`${paymentAttempts.createdAt} < ${cutoff}`))
    .returning({ id: paymentAttempts.id });
  return rows.length;
}
