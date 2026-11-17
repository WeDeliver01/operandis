import crypto from "node:crypto";
import dns from "node:dns/promises";
import type { AppConfig } from "../../config/env";
import type { CheckoutInput, CheckoutResult, PaymentProviderAdapter, WebhookRequest, WebhookVerification } from "./types";
import { ProviderError } from "./types";

/**
 * PayFast hosted checkout (form POST) + ITN (Instant Transaction Notification).
 * Docs: https://developers.payfast.co.za/docs
 *
 * ITN verification performs all four PayFast-recommended checks:
 *   1. signature (MD5 of the posted parameter string + passphrase)
 *   2. source IP belongs to PayFast (optional, PAYFAST_VERIFY_SOURCE_IP)
 *   3. amount/reference reconciliation (done by the payment service)
 *   4. server-to-server confirmation with PayFast's /eng/query/validate
 */

const HOSTS = { sandbox: "sandbox.payfast.co.za", live: "www.payfast.co.za" } as const;
const VALID_HOSTS = ["www.payfast.co.za", "sandbox.payfast.co.za", "w1w.payfast.co.za", "w2w.payfast.co.za"];

/** PHP urlencode() semantics, which PayFast uses for signatures. */
export function phpUrlEncode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
    .replace(/%20/g, "+");
}

export function payfastSignature(pairs: [string, string][], passphrase?: string): string {
  let str = pairs
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`)
    .join("&");
  if (passphrase) str += `&passphrase=${phpUrlEncode(passphrase.trim())}`;
  return crypto.createHash("md5").update(str).digest("hex");
}

/** Parse an x-www-form-urlencoded body preserving field order (order matters for the signature). */
export function parseOrderedForm(raw: string): [string, string][] {
  return raw
    .split("&")
    .filter(Boolean)
    .map((pair) => {
      const idx = pair.indexOf("=");
      const k = idx >= 0 ? pair.slice(0, idx) : pair;
      const v = idx >= 0 ? pair.slice(idx + 1) : "";
      const dec = (s: string) => decodeURIComponent(s.replace(/\+/g, " "));
      return [dec(k), dec(v)] as [string, string];
    });
}

const toMinor = (v: string | undefined) => (v === undefined || v === "" ? null : Math.round(Number(v) * 100));

export class PayFastAdapter implements PaymentProviderAdapter {
  readonly key = "payfast" as const;
  readonly label = "Card / Instant EFT (PayFast)";
  readonly supportsRefunds = false;

  constructor(
    private config: AppConfig,
    private validateRemotely: (paramString: string) => Promise<boolean> = (p) => this.remoteValidate(p),
  ) {}

  configured(): boolean {
    return Boolean(this.config.PAYFAST_MERCHANT_ID && this.config.PAYFAST_MERCHANT_KEY);
  }

  private host() {
    return HOSTS[this.config.PAYFAST_MODE];
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    if (!this.configured()) throw new ProviderError("payfast", "PayFast is not configured");
    const [first, ...rest] = input.customer.name.trim().split(/\s+/);
    // Order is significant: PayFast's documented attribute order.
    const pairs: [string, string][] = [
      ["merchant_id", this.config.PAYFAST_MERCHANT_ID!],
      ["merchant_key", this.config.PAYFAST_MERCHANT_KEY!],
      ["return_url", input.returnUrl],
      ["cancel_url", input.cancelUrl],
      ["notify_url", input.notifyUrl],
      ["name_first", first ?? ""],
      ["name_last", rest.join(" ")],
      ["email_address", input.customer.email],
      ["m_payment_id", input.reference],
      ["amount", (input.amountMinor / 100).toFixed(2)],
      ["item_name", input.description.slice(0, 100)],
    ];
    const signature = payfastSignature(pairs, this.config.PAYFAST_PASSPHRASE);
    const fields: Record<string, string> = {};
    for (const [k, v] of pairs) if (v !== "") fields[k] = v;
    fields.signature = signature;
    return { method: "POST", url: `https://${this.host()}/eng/process`, fields, providerCheckoutId: null };
  }

  async verifyWebhook(req: WebhookRequest): Promise<WebhookVerification> {
    const raw = req.rawBody.toString("utf8");
    const pairs = parseOrderedForm(raw);
    const data = Object.fromEntries(pairs);
    const redacted: Record<string, unknown> = { ...data };
    delete redacted.signature;
    delete redacted.email_address;
    delete redacted.name_first;
    delete redacted.name_last;
    delete redacted.cell_number;
    const eventId = data.pf_payment_id ? `${data.pf_payment_id}:${data.payment_status ?? ""}` : null;

    const withoutSig = pairs.filter(([k]) => k !== "signature");
    // PayFast ITN signatures include every posted field (empty ones too) in posted order.
    let str = withoutSig.map(([k, v]) => `${k}=${phpUrlEncode(v.trim())}`).join("&");
    const paramString = str;
    if (this.config.PAYFAST_PASSPHRASE) str += `&passphrase=${phpUrlEncode(this.config.PAYFAST_PASSPHRASE.trim())}`;
    const expected = crypto.createHash("md5").update(str).digest("hex");
    if (!data.signature || expected !== data.signature) return { ok: false, reason: "invalid_signature", eventId, redacted };

    if (data.merchant_id !== this.config.PAYFAST_MERCHANT_ID) return { ok: false, reason: "merchant_mismatch", eventId, redacted };

    if (this.config.PAYFAST_VERIFY_SOURCE_IP && !(await this.isPayFastIp(req.ip))) {
      return { ok: false, reason: "untrusted_source_ip", eventId, redacted };
    }

    const skipRemote = this.config.PAYFAST_SKIP_REMOTE_VALIDATION && this.config.PAYFAST_MODE === "sandbox";
    if (!skipRemote) {
      const valid = await this.validateRemotely(paramString).catch(() => false);
      if (!valid) return { ok: false, reason: "remote_validation_failed", eventId, redacted };
    }

    const status = (data.payment_status ?? "").toUpperCase();
    const outcome = status === "COMPLETE" ? "succeeded" : status === "FAILED" ? "failed" : status === "CANCELLED" ? "cancelled" : status === "PENDING" ? "pending" : "ignored";
    return {
      ok: true,
      event: {
        eventId: eventId ?? `${data.m_payment_id}:${status}`,
        eventType: `itn.${status.toLowerCase() || "unknown"}`,
        reference: data.m_payment_id ?? null,
        providerCheckoutId: null,
        providerTransactionId: data.pf_payment_id ?? null,
        outcome,
        amountMinor: toMinor(data.amount_gross),
        feeMinor: data.amount_fee ? Math.abs(toMinor(data.amount_fee) ?? 0) : null,
        currency: "ZAR",
        failureReason: outcome === "failed" ? "Payment declined by PayFast" : outcome === "cancelled" ? "Payment cancelled" : null,
        redacted,
      },
    };
  }

  private async isPayFastIp(ip: string | undefined): Promise<boolean> {
    if (!ip) return false;
    const clean = ip.replace(/^::ffff:/, "");
    const lookups = await Promise.all(VALID_HOSTS.map((h) => dns.resolve4(h).catch(() => [] as string[])));
    return lookups.flat().includes(clean);
  }

  private async remoteValidate(paramString: string): Promise<boolean> {
    const res = await fetch(`https://${this.host()}/eng/query/validate`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: paramString,
      signal: AbortSignal.timeout(10_000),
    });
    const text = (await res.text()).trim();
    return res.ok && text === "VALID";
  }
}
