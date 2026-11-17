import { useEffect, useRef } from "react";
import { useConsent } from "@/lib/consent";
import { TAG_IDS, loadGoogleAds, loadGoogleAnalytics, loadLinkedInInsight, loadMetaPixel } from "@/lib/tags";
import { clearAnalyticsIdentity } from "@/lib/analytics";

/** Remove first-party cookies set by analytics/advertising tags (on consent withdrawal). */
function clearTrackingCookies() {
  const names = document.cookie.split(";").map((c) => c.split("=")[0].trim());
  const host = window.location.hostname;
  const domains = [host, `.${host}`, `.${host.split(".").slice(-2).join(".")}`];
  for (const name of names) {
    if (/^(_ga|_gid|_gat|_gcl|_fbp|_fbc|li_|lms_|AnalyticsSyncHistory|UserMatchHistory)/.test(name)) {
      for (const d of domains) document.cookie = `${name}=; Max-Age=0; path=/; domain=${d}`;
      document.cookie = `${name}=; Max-Age=0; path=/`;
    }
  }
}

export function TagManager() {
  const { state } = useConsent();
  const previous = useRef(state);

  useEffect(() => {
    const prev = previous.current;
    previous.current = state;
    const w = window as unknown as { gtag?: (...args: unknown[]) => void };

    // Withdrawal: tell Google tags consent is denied, drop cookies and our anonymous id.
    // Scripts already loaded in this page stay in memory until the next navigation/reload.
    if ((prev.analytics && !state.analytics) || (prev.advertising && !state.advertising)) {
      w.gtag?.("consent", "update", {
        analytics_storage: state.analytics ? "granted" : "denied",
        ad_storage: state.advertising ? "granted" : "denied",
        ad_user_data: state.advertising ? "granted" : "denied",
        ad_personalization: state.advertising ? "granted" : "denied",
      });
      clearTrackingCookies();
      if (!state.analytics) clearAnalyticsIdentity();
    }

    if (!state.decided) return;
    if (state.analytics && TAG_IDS.ga4) loadGoogleAnalytics(TAG_IDS.ga4);
    if (state.advertising) {
      if (TAG_IDS.googleAds) loadGoogleAds(TAG_IDS.googleAds);
      if (TAG_IDS.metaPixel) loadMetaPixel(TAG_IDS.metaPixel);
      if (TAG_IDS.linkedInPartner) loadLinkedInInsight(TAG_IDS.linkedInPartner);
    }
  }, [state]);

  return null;
}
