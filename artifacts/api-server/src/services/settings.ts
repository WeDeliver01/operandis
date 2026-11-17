import { eq } from "drizzle-orm";
import { settings, type Database, type DbOrTx } from "@workspace/db";
import { SETTINGS_SCHEMAS, type BusinessSettings, type CommerceSettings, type SecuritySettings, type SettingsKey, type TaxSettings } from "@workspace/api-zod";
import type { TaxConfig } from "@workspace/domain";
import type { z } from "zod/v4";

/**
 * Defaults are deliberately conservative: no VAT, no payment provider enabled
 * until configured, terms marked as draft. They are owner decisions (spec §15).
 */
export const SETTINGS_DEFAULTS: { [K in SettingsKey]: z.infer<(typeof SETTINGS_SCHEMAS)[K]> } = {
  business: {
    tradingName: "Operandis",
    legalName: "Operandis (trading name)",
    registrationNumber: "",
    email: "hello@operandi.studio",
    legalEmail: "legal@operandi.studio",
    phone: "",
    address: ["10 Camellia Avenue", "Lynnwood, Pretoria, 0081", "South Africa"],
    hours: ["Monday – Friday", "08h00 – 17h00 SAST", "By appointment."],
    calLink: "ashleybaloyi/30-minute-consultation",
    linkedinUrl: "",
    staffAlertEmails: [],
  },
  tax: { enabled: false, rateBps: 1500, label: "VAT", pricesIncludeTax: false, vatNumber: null, confirmedByOwner: false },
  commerce: {
    termsVersion: "2026-11-draft",
    termsSummary:
      "Work is delivered against the written scope for the package or proposal you accept. Changes outside that scope are handled through change control.",
    refundPolicySummary:
      "Deposits secure capacity and are refundable in full if cancelled before work starts. Once work has started, completed milestones are non-refundable. Statutory consumer rights are not affected.",
    invoiceDueDays: 7,
    proposalExpiryDays: 30,
    defaultDepositBps: 5000,
    enabledProviders: ["eft"],
    defaultProvider: "eft",
    eft: { bankName: "", accountName: "", accountNumber: "", branchCode: "", accountType: "Business cheque" },
  },
  security: { requireStaffMfa: false, sessionDays: 14 },
  configurator: { enabled: true },
};

export class SettingsService {
  private cache = new Map<SettingsKey, { value: unknown; at: number }>();
  constructor(private db: Database, private ttlMs = 5_000) {}

  async get<K extends SettingsKey>(key: K, tx?: DbOrTx): Promise<z.infer<(typeof SETTINGS_SCHEMAS)[K]>> {
    const cached = this.cache.get(key);
    if (!tx && cached && Date.now() - cached.at < this.ttlMs) return cached.value as never;
    const rows = await (tx ?? this.db).select().from(settings).where(eq(settings.key, key));
    const schema = SETTINGS_SCHEMAS[key];
    const merged = { ...(SETTINGS_DEFAULTS[key] as object), ...((rows[0]?.value as object) ?? {}) };
    const parsed = schema.safeParse(merged);
    const value = parsed.success ? parsed.data : SETTINGS_DEFAULTS[key];
    this.cache.set(key, { value, at: Date.now() });
    return value as never;
  }

  async set<K extends SettingsKey>(key: K, value: z.infer<(typeof SETTINGS_SCHEMAS)[K]>, actorId: string | null, tx?: DbOrTx) {
    await (tx ?? this.db)
      .insert(settings)
      .values({ key, value, updatedById: actorId })
      .onConflictDoUpdate({ target: settings.key, set: { value, updatedById: actorId, updatedAt: new Date() } });
    this.cache.delete(key);
  }

  invalidate() {
    this.cache.clear();
  }

  async business(): Promise<BusinessSettings> {
    return this.get("business");
  }
  async commerce(): Promise<CommerceSettings> {
    return this.get("commerce");
  }
  async security(): Promise<SecuritySettings> {
    return this.get("security");
  }
  async taxSettings(): Promise<TaxSettings> {
    return this.get("tax");
  }
  /** Tax is applied only when enabled AND confirmed by the owner. */
  async tax(tx?: DbOrTx): Promise<TaxConfig & { vatNumber: string | null }> {
    const t = await this.get("tax", tx);
    const enabled = t.enabled && t.confirmedByOwner;
    return { enabled, rateBps: t.rateBps, label: t.label, pricesIncludeTax: t.pricesIncludeTax, vatNumber: t.vatNumber };
  }
}
