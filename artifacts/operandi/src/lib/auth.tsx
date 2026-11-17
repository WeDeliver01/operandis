import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Redirect, useLocation } from "wouter";
import type { Me } from "@workspace/api-zod";
import type { Permission } from "@workspace/domain";
import { get, post } from "./api";
import { LoadingState } from "@/components/ui-kit/states";

interface AuthContextValue {
  me: Me | null;
  loading: boolean;
  refresh: () => Promise<void>;
  setMe: (me: Me | null) => void;
  logout: () => Promise<void>;
  can: (p: Permission) => boolean;
  isStaff: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["me"],
    queryFn: async () => (await get<{ user: Me | null }>("/auth/session")).user,
    staleTime: 60_000,
    retry: false,
  });
  // Fetch the session and write it to the cache before resolving, so a navigation
  // right after sign-in never sees a stale anonymous session.
  const refresh = useCallback(async () => {
    const r = await get<{ user: Me | null }>("/auth/session");
    qc.setQueryData(["me"], r.user);
  }, [qc]);
  const logout = useCallback(async () => {
    await post("/auth/logout");
    qc.clear();
    qc.setQueryData(["me"], null);
  }, [qc]);
  const setMe = useCallback((value: Me | null) => qc.setQueryData(["me"], value), [qc]);
  const me = query.data ?? null;
  const value = useMemo<AuthContextValue>(
    () => ({
      me,
      loading: query.isLoading,
      refresh,
      setMe,
      logout,
      can: (p) => Boolean(me?.permissions.includes(p)),
      isStaff: Boolean(me && me.role !== "client"),
    }),
    [me, query.isLoading, refresh, setMe, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

/** Route guard. Server-side checks remain authoritative; this only improves UX. */
export function RequireAuth({ children, staff, permission }: { children: ReactNode; staff?: boolean; permission?: Permission }) {
  const { me, loading, can } = useAuth();
  useLocation(); // re-render on navigation
  const location = `${window.location.pathname}${window.location.search}`;
  if (loading) return <LoadingState label="Checking your session…" full />;
  if (!me) return <Redirect to={`/login?next=${encodeURIComponent(location)}`} />;
  if (staff && me.role === "client") return <Redirect to="/portal" />;
  if (staff && me.mfaRequired && !me.mfaVerified) return <Redirect to={`/auth/mfa?next=${encodeURIComponent(location)}`} />;
  if (permission && !can(permission)) return <Forbidden />;
  return <>{children}</>;
}

export function Forbidden() {
  return (
    <div className="py-24 text-center">
      <h1 className="font-serif text-[28px] text-ink">You don't have access to this page</h1>
      <p className="text-muted mt-3">Ask an administrator if you need this permission.</p>
    </div>
  );
}
