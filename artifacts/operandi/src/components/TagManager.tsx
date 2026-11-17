import { useEffect } from "react";
import { useConsent } from "@/lib/consent";
import { TAG_IDS, loadGoogleAds, loadGoogleAnalytics, loadLinkedInInsight, loadMetaPixel } from "@/lib/tags";

export function TagManager() {
  const { state } = useConsent();

  useEffect(() => {
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
