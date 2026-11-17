import type { PaymentProvider } from "@workspace/db";
import type { AppConfig } from "../../config/env";
import { PayFastAdapter } from "./payfast";
import { YocoAdapter } from "./yoco";
import type { CheckoutInput, CheckoutResult, PaymentProviderAdapter, WebhookVerification } from "./types";

/** Manual EFT: no gateway; funds are confirmed by finance staff against the bank statement. */
export class EftAdapter implements PaymentProviderAdapter {
  readonly key = "eft" as const;
  readonly label = "Manual EFT (bank transfer)";
  readonly supportsRefunds = false;
  configured() {
    return true;
  }
  async createCheckout(_input: CheckoutInput): Promise<CheckoutResult> {
    return { method: "NONE", url: null, fields: null, providerCheckoutId: null };
  }
  async verifyWebhook(): Promise<WebhookVerification> {
    return { ok: false, reason: "eft_has_no_webhooks", eventId: null, redacted: {} };
  }
}

export class PaymentRegistry {
  private adapters = new Map<PaymentProvider, PaymentProviderAdapter>();
  constructor(adapters: PaymentProviderAdapter[]) {
    for (const a of adapters) this.adapters.set(a.key, a);
  }
  get(key: PaymentProvider): PaymentProviderAdapter | undefined {
    return this.adapters.get(key);
  }
  /** Providers that are both configured (credentials present) and enabled in settings. */
  available(enabled: PaymentProvider[]): PaymentProviderAdapter[] {
    return enabled.map((k) => this.adapters.get(k)).filter((a): a is PaymentProviderAdapter => Boolean(a?.configured()));
  }
}

export function createPaymentRegistry(config: AppConfig, overrides: Partial<Record<PaymentProvider, PaymentProviderAdapter>> = {}): PaymentRegistry {
  return new PaymentRegistry([overrides.payfast ?? new PayFastAdapter(config), overrides.yoco ?? new YocoAdapter(config), overrides.eft ?? new EftAdapter()]);
}

export * from "./types";
