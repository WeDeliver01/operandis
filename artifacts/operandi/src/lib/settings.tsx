import { useQuery } from "@tanstack/react-query";
import type { PublicSettings } from "@workspace/api-zod";
import { get } from "./api";

/** Fallback used until the API responds (or if it is unreachable): mirrors the original static site. */
export const DEFAULT_SETTINGS: PublicSettings = {
  business: {
    tradingName: "Operandis",
    legalName: "Operandis",
    email: "hello@operandi.studio",
    legalEmail: "legal@operandi.studio",
    phone: "",
    address: ["10 Camellia Avenue", "Lynnwood, Pretoria, 0081", "South Africa"],
    hours: ["Monday – Friday", "08h00 – 17h00 SAST", "By appointment."],
    calLink: "ashleybaloyi/30-minute-consultation",
    linkedinUrl: "",
  },
  commerce: { currency: "ZAR", termsVersion: "", refundPolicySummary: "", paymentProviders: [], taxLabel: null, pricesShownIncludeTax: false },
  configurator: { enabled: true, demoPricing: false, pricingActive: false },
};

export function usePublicSettings(): PublicSettings {
  const q = useQuery({ queryKey: ["settings", "public"], queryFn: () => get<PublicSettings>("/settings/public"), staleTime: 5 * 60_000, retry: 1 });
  return q.data ?? DEFAULT_SETTINGS;
}

export function useBrand(): string {
  return usePublicSettings().business.tradingName;
}
