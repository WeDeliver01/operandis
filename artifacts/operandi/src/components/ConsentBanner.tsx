import { useEffect, useState } from "react";
import { Link } from "wouter";
import { X } from "lucide-react";
import { useConsent } from "@/lib/consent";

export function ConsentBanner() {
  const { bannerOpen, state, acceptAll, rejectAll, save, closePreferences } = useConsent();
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(state.analytics);
  const [advertising, setAdvertising] = useState(state.advertising);

  useEffect(() => {
    if (bannerOpen) {
      setAnalytics(state.analytics);
      setAdvertising(state.advertising);
      setShowDetails(false);
    }
  }, [bannerOpen, state.analytics, state.advertising]);

  if (!bannerOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Cookie preferences"
      className="fixed bottom-4 left-4 right-4 md:left-6 md:right-auto md:bottom-6 md:max-w-[440px] z-[100] bg-paper border hairline rounded-sm shadow-ambient p-6"
    >
      {state.decided && (
        <button
          type="button"
          onClick={closePreferences}
          className="absolute top-3 right-3 p-1 text-faint hover:text-ink transition-colors"
          aria-label="Close preferences"
        >
          <X size={16} />
        </button>
      )}

      <h2 className="font-serif text-[18px] font-medium text-ink mb-2">Cookies on this site</h2>
      <p className="text-[14px] text-muted leading-relaxed">
        We use strictly necessary cookies to run the site, and — with your consent — analytics
        and advertising cookies (Google Analytics, Google Ads, Meta Pixel, LinkedIn) to
        understand traffic and measure our marketing. See our{" "}
        <Link href="/cookies" className="text-ink underline hover:text-accent">
          Cookie Notice
        </Link>
        .
      </p>

      {showDetails && (
        <div className="mt-4 space-y-3 border-t hairline pt-4">
          <label className="flex items-start gap-3 text-[13px] text-ink">
            <input
              type="checkbox"
              checked
              disabled
              className="mt-1 accent-ink"
              aria-label="Strictly necessary (always on)"
            />
            <span>
              <strong>Strictly necessary</strong> — always on. Required to keep the site running
              and to load the booking widget.
            </span>
          </label>
          <label className="flex items-start gap-3 text-[13px] text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={analytics}
              onChange={(e) => setAnalytics(e.target.checked)}
              className="mt-1 accent-ink"
            />
            <span>
              <strong>Analytics</strong> — Google Analytics 4. Lets us understand which pages
              and channels are working.
            </span>
          </label>
          <label className="flex items-start gap-3 text-[13px] text-ink cursor-pointer">
            <input
              type="checkbox"
              checked={advertising}
              onChange={(e) => setAdvertising(e.target.checked)}
              className="mt-1 accent-ink"
            />
            <span>
              <strong>Advertising</strong> — Google Ads, Meta Pixel, LinkedIn Insight Tag.
              Measures campaigns and shows relevant follow-up ads.
            </span>
          </label>
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-2">
        {showDetails ? (
          <button
            type="button"
            onClick={() => save({ analytics, advertising })}
            className="text-[12px] font-medium uppercase tracking-wider bg-ink text-paper px-4 py-2.5 rounded-sm hover:bg-accent transition-colors"
          >
            Save preferences
          </button>
        ) : (
          <button
            type="button"
            onClick={acceptAll}
            className="text-[12px] font-medium uppercase tracking-wider bg-ink text-paper px-4 py-2.5 rounded-sm hover:bg-accent transition-colors"
          >
            Accept all
          </button>
        )}
        <button
          type="button"
          onClick={rejectAll}
          className="text-[12px] font-medium uppercase tracking-wider border border-ink text-ink px-4 py-2.5 rounded-sm hover:bg-ink hover:text-paper transition-colors"
        >
          Reject non-essential
        </button>
        {!showDetails && (
          <button
            type="button"
            onClick={() => setShowDetails(true)}
            className="text-[12px] font-medium uppercase tracking-wider text-muted hover:text-ink transition-colors px-2 py-2.5"
          >
            Customise
          </button>
        )}
      </div>
    </div>
  );
}

export function CookiePreferencesLink({ className }: { className?: string }) {
  const { openPreferences } = useConsent();
  return (
    <button
      type="button"
      onClick={openPreferences}
      className={className ?? "text-[14px] text-ink hover:text-muted text-left"}
    >
      Cookie preferences
    </button>
  );
}
