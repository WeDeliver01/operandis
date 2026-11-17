import { createContext, useCallback, useContext, useEffect, useMemo, useState, ReactNode } from "react";

export type ConsentCategory = "analytics" | "advertising";

export interface ConsentState {
  analytics: boolean;
  advertising: boolean;
  decided: boolean;
}

const STORAGE_KEY = "operandi.consent.v1";
const DEFAULT_STATE: ConsentState = { analytics: false, advertising: false, decided: false };

function readStored(): ConsentState {
  if (typeof window === "undefined") return DEFAULT_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    const parsed = JSON.parse(raw);
    return {
      analytics: Boolean(parsed.analytics),
      advertising: Boolean(parsed.advertising),
      decided: Boolean(parsed.decided),
    };
  } catch {
    return DEFAULT_STATE;
  }
}

interface ConsentContextValue {
  state: ConsentState;
  bannerOpen: boolean;
  acceptAll: () => void;
  rejectAll: () => void;
  save: (next: Pick<ConsentState, "analytics" | "advertising">) => void;
  openPreferences: () => void;
  closePreferences: () => void;
}

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ConsentState>(DEFAULT_STATE);
  const [bannerOpen, setBannerOpen] = useState(false);

  useEffect(() => {
    const stored = readStored();
    setState(stored);
    if (!stored.decided) setBannerOpen(true);
  }, []);

  const persist = useCallback((next: ConsentState) => {
    setState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore quota / disabled storage
    }
  }, []);

  const acceptAll = useCallback(() => {
    persist({ analytics: true, advertising: true, decided: true });
    setBannerOpen(false);
  }, [persist]);

  const rejectAll = useCallback(() => {
    persist({ analytics: false, advertising: false, decided: true });
    setBannerOpen(false);
  }, [persist]);

  const save = useCallback(
    (next: Pick<ConsentState, "analytics" | "advertising">) => {
      persist({ ...next, decided: true });
      setBannerOpen(false);
    },
    [persist],
  );

  const openPreferences = useCallback(() => setBannerOpen(true), []);
  const closePreferences = useCallback(() => {
    if (state.decided) setBannerOpen(false);
  }, [state.decided]);

  const value = useMemo<ConsentContextValue>(
    () => ({ state, bannerOpen, acceptAll, rejectAll, save, openPreferences, closePreferences }),
    [state, bannerOpen, acceptAll, rejectAll, save, openPreferences, closePreferences],
  );

  return <ConsentContext.Provider value={value}>{children}</ConsentContext.Provider>;
}

export function useConsent() {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error("useConsent must be used inside ConsentProvider");
  return ctx;
}
