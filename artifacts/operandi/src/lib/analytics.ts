import type { AnalyticsEvent } from "@workspace/domain";
import { API_BASE } from "./api";

/**
 * Consent-aware funnel tracking. Nothing is sent unless the visitor granted
 * analytics consent; the anonymous id is created only after consent too.
 */
const CONSENT_KEY = "operandi.consent.v1";
const ANON_KEY = "operandis.anon.v1";

function analyticsAllowed(): boolean {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw ? Boolean(JSON.parse(raw).analytics) : false;
  } catch {
    return false;
  }
}

function anonymousId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "anonymous";
  }
}

export function clearAnalyticsIdentity() {
  try {
    localStorage.removeItem(ANON_KEY);
  } catch {
    /* ignore */
  }
}

export function trackEvent(name: AnalyticsEvent, data: { entityType?: string; entityId?: string; properties?: Record<string, string | number | boolean> } = {}) {
  if (!analyticsAllowed()) return;
  const body = JSON.stringify({ name, anonymousId: anonymousId(), ...data });
  const csrf = document.cookie.match(/(?:^|; )op_csrf=([^;]*)/)?.[1];
  void fetch(`${API_BASE}/events`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(csrf ? { "x-csrf-token": decodeURIComponent(csrf) } : {}) },
    body,
    credentials: "same-origin",
    keepalive: true,
  }).catch(() => undefined);
  const w = window as unknown as { gtag?: (...args: unknown[]) => void };
  w.gtag?.("event", name, data.properties ?? {});
}

/** Capture UTM parameters once per session for lead attribution (first-party, not shared). */
export function attribution(): Record<string, string> {
  try {
    const stored = sessionStorage.getItem("operandis.utm");
    if (stored) return JSON.parse(stored);
    const params = new URLSearchParams(window.location.search);
    const out: Record<string, string> = {};
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"]) {
      const v = params.get(k);
      if (v) out[k] = v.slice(0, 200);
    }
    if (document.referrer && !document.referrer.startsWith(window.location.origin)) out.referrer = document.referrer.slice(0, 200);
    sessionStorage.setItem("operandis.utm", JSON.stringify(out));
    return out;
  } catch {
    return {};
  }
}
