export const TAG_IDS = {
  ga4: import.meta.env.VITE_GA4_ID as string | undefined,
  googleAds: import.meta.env.VITE_GOOGLE_ADS_ID as string | undefined,
  metaPixel: import.meta.env.VITE_META_PIXEL_ID as string | undefined,
  linkedInPartner: import.meta.env.VITE_LINKEDIN_PARTNER_ID as string | undefined,
};

const loaded = new Set<string>();

function injectScript(id: string, build: () => HTMLScriptElement) {
  if (loaded.has(id)) return;
  if (document.getElementById(id)) {
    loaded.add(id);
    return;
  }
  const el = build();
  el.id = id;
  document.head.appendChild(el);
  loaded.add(id);
}

function ensureGtag() {
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  w.dataLayer = w.dataLayer || [];
  if (!w.gtag) {
    w.gtag = function (...args: unknown[]) {
      w.dataLayer!.push(args);
    };
    w.gtag("js", new Date());
  }
  return w.gtag;
}

export function loadGoogleAnalytics(id: string) {
  injectScript(`ga4-loader-${id}`, () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    return s;
  });
  const gtag = ensureGtag();
  gtag("config", id, { anonymize_ip: true, allow_google_signals: false });
}

export function loadGoogleAds(id: string) {
  injectScript(`gads-loader-${id}`, () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = `https://www.googletagmanager.com/gtag/js?id=${id}`;
    return s;
  });
  const gtag = ensureGtag();
  gtag("config", id);
}

export function loadMetaPixel(id: string) {
  if (loaded.has(`meta-${id}`)) return;
  const w = window as unknown as { fbq?: ((...args: unknown[]) => void) & Record<string, unknown> };
  if (!w.fbq) {
    const fbq: ((...args: unknown[]) => void) & Record<string, unknown> = function (...args: unknown[]) {
      const f = fbq as unknown as { callMethod?: (...a: unknown[]) => void; queue: unknown[][] };
      if (f.callMethod) f.callMethod(...args);
      else f.queue.push(args);
    } as ((...args: unknown[]) => void) & Record<string, unknown>;
    (fbq as unknown as { queue: unknown[][] }).queue = [];
    (fbq as unknown as { loaded: boolean }).loaded = true;
    (fbq as unknown as { version: string }).version = "2.0";
    w.fbq = fbq;
    (window as unknown as { _fbq?: unknown })._fbq = fbq;
  }
  injectScript(`meta-pixel-loader`, () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://connect.facebook.net/en_US/fbevents.js";
    return s;
  });
  w.fbq!("init", id);
  w.fbq!("track", "PageView");
  loaded.add(`meta-${id}`);
}

export function loadLinkedInInsight(partnerId: string) {
  if (loaded.has(`li-${partnerId}`)) return;
  const w = window as unknown as { _linkedin_partner_id?: string; _linkedin_data_partner_ids?: string[] };
  w._linkedin_data_partner_ids = w._linkedin_data_partner_ids || [];
  w._linkedin_data_partner_ids.push(partnerId);
  w._linkedin_partner_id = partnerId;
  injectScript("linkedin-insight-loader", () => {
    const s = document.createElement("script");
    s.async = true;
    s.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
    return s;
  });
  loaded.add(`li-${partnerId}`);
}
