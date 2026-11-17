import crypto from "node:crypto";
import type { AppConfig } from "../../config/env";
import type { CheckoutInput, CheckoutResult, PaymentProviderAdapter, RefundResult, WebhookRequest, WebhookVerification } from "./types";
import { ProviderError } from "./types";

/**
 * Yoco Checkout API (hosted payment page) + signed webhooks.
 * Docs: https://developer.yoco.com/online/checkout
 * Webhooks are signed Standard-Webhooks style: HMAC-SHA256 over
 * `${webhook-id}.${webhook-timestamp}.${rawBody}` using the base64 secret after "whsec_".
 */

const TOLERANCE_SECONDS = 180;

export function yocoSignature(secret: string, id: string, timestamp: string, body: string): string {
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  return crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
}

const header = (h: WebhookRequest["headers"], name: string) => {
  const v = h[name];
  return Array.isArray(v) ? v[0] : v;
};

export class YocoAdapter implements PaymentProviderAdapter {
  readonly key = "yoco" as const;
  readonly label = "Card (Yoco)";
  readonly supportsRefunds = true;

  constructor(private config: AppConfig, private fetchImpl: typeof fetch = fetch) {}

  configured(): boolean {
    return Boolean(this.config.YOCO_SECRET_KEY && this.config.YOCO_WEBHOOK_SECRET);
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!this.configured()) throw new ProviderError("yoco", "Yoco is not configured");
    const res = await this.fetchImpl(`${this.config.YOCO_API_URL}/api/checkouts`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.config.YOCO_SECRET_KEY}`,
        "content-type": "application/json",
        "idempotency-key": input.idempotencyKey,
      },
      body: JSON.stringify({
        amount: input.amountMinor,
        currency: input.currency,
        successUrl: input.returnUrl,
        cancelUrl: input.cancelUrl,
        failureUrl: input.cancelUrl,
        externalId: input.reference,
        metadata: { reference: input.reference, description: input.description.slice(0, 100) },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new ProviderError("yoco", `Yoco checkout creation failed (HTTP ${res.status})`);
    const json = (await res.json()) as { id: string; redirectUrl: string };
    return { method: "GET", url: json.redirectUrl, fields: null, providerCheckoutId: json.id };
  }

  async verifyWebhook(req: WebhookRequest): Promise<WebhookVerification> {
    const id = header(req.headers, "webhook-id");
    const ts = header(req.headers, "webhook-timestamp");
    const sigHeader = header(req.headers, "webhook-signature");
    const body = req.rawBody.toString("utf8");
    let parsed: { id?: string; type?: string; payload?: Record<string, unknown> } = {};
    try {
      parsed = JSON.parse(body);
    } catch {
      return { ok: false, reason: "invalid_json", eventId: id ?? null, redacted: {} };
    }
    const payload = (parsed.payload ?? {}) as { id?: string; amount?: number; currency?: string; status?: string; metadata?: Record<string, string> };
    const redacted = { type: parsed.type, paymentId: payload.id, amount: payload.amount, currency: payload.currency, status: payload.status, metadata: payload.metadata };
    if (!id || !ts || !sigHeader || !this.config.YOCO_WEBHOOK_SECRET) return { ok: false, reason: "missing_signature", eventId: id ?? null, redacted };
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) return { ok: false, reason: "stale_timestamp", eventId: id, redacted };
    const expected = yocoSignature(this.config.YOCO_WEBHOOK_SECRET, id, ts, body);
    const provided = sigHeader.split(" ").map((s) => s.split(",")[1]).filter(Boolean);
    const match = provided.some((p) => p.length === expected.length && crypto.timingSafeEqual(Buffer.from(p), Buffer.from(expected)));
    if (!match) return { ok: false, reason: "invalid_signature", eventId: id, redacted };

    const type = parsed.type ?? "unknown";
    const outcome =
      type === "payment.succeeded" ? "succeeded" : type === "payment.failed" ? "failed" : type === "refund.succeeded" ? "refunded" : "ignored";
    return {
      ok: true,
      event: {
        eventId: id,
        eventType: type,
        reference: payload.metadata?.reference ?? null,
        providerCheckoutId: payload.metadata?.checkoutId ?? null,
        providerTransactionId: payload.id ?? null,
        outcome,
        amountMinor: typeof payload.amount === "number" ? payload.amount : null,
        feeMinor: null,
        currency: payload.currency ?? null,
        failureReason: outcome === "failed" ? "Card payment failed" : null,
        redacted,
      },
    };
  }

  async refund(input: { providerCheckoutId: string | null; providerTransactionId: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult> {
    if (!input.providerCheckoutId) return { status: "failed", providerRefundId: null, failureReason: "Missing Yoco checkout id" };
    const res = await this.fetchImpl(`${this.config.YOCO_API_URL}/api/checkouts/${encodeURIComponent(input.providerCheckoutId)}/refund`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.config.YOCO_SECRET_KEY}`, "content-type": "application/json", "idempotency-key": input.idempotencyKey },
      body: JSON.stringify({ amount: input.amountMinor }),
      signal: AbortSignal.timeout(15_000),
    });
    const json = (await res.json().catch(() => ({}))) as { refundId?: string; id?: string; status?: string; message?: string };
    if (!res.ok) return { status: "failed", providerRefundId: null, failureReason: json.message ?? `HTTP ${res.status}` };
    return { status: json.status === "succeeded" ? "succeeded" : "pending", providerRefundId: json.refundId ?? json.id ?? null };
  }
}
