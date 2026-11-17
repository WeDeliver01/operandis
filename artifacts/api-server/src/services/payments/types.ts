import type { PaymentProvider } from "@workspace/db";

export interface CheckoutInput {
  reference: string;
  amountMinor: number;
  currency: "ZAR";
  description: string;
  customer: { name: string; email: string; phone?: string };
  returnUrl: string;
  cancelUrl: string;
  notifyUrl: string;
  idempotencyKey: string;
}

export interface CheckoutResult {
  method: "GET" | "POST" | "NONE";
  url: string | null;
  fields: Record<string, string> | null;
  providerCheckoutId: string | null;
}

export interface WebhookRequest {
  rawBody: Buffer;
  headers: Record<string, string | string[] | undefined>;
  ip: string | undefined;
}

/** A provider notification whose authenticity has been verified. */
export interface VerifiedPaymentEvent {
  eventId: string;
  eventType: string;
  /** Our payment attempt reference, if the provider echoes it. */
  reference: string | null;
  /** Provider checkout/session id (used when reference isn't echoed). */
  providerCheckoutId: string | null;
  providerTransactionId: string | null;
  outcome: "succeeded" | "failed" | "cancelled" | "pending" | "refunded" | "ignored";
  amountMinor: number | null;
  feeMinor: number | null;
  currency: string | null;
  failureReason: string | null;
  redacted: Record<string, unknown>;
}

export type WebhookVerification =
  | { ok: true; event: VerifiedPaymentEvent }
  | { ok: false; reason: string; eventId: string | null; redacted: Record<string, unknown> };

export interface RefundResult {
  status: "succeeded" | "pending" | "failed" | "manual_pending";
  providerRefundId: string | null;
  failureReason?: string;
}

export interface PaymentProviderAdapter {
  readonly key: PaymentProvider;
  readonly label: string;
  /** True when credentials are present so live/sandbox checkouts can be created. */
  configured(): boolean;
  readonly supportsRefunds: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  verifyWebhook(req: WebhookRequest): Promise<WebhookVerification>;
  refund?(input: { providerCheckoutId: string | null; providerTransactionId: string; amountMinor: number; idempotencyKey: string }): Promise<RefundResult>;
}

export class ProviderError extends Error {
  constructor(public readonly provider: string, message: string) {
    super(message);
    this.name = "ProviderError";
  }
}
