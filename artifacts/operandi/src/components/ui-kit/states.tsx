import type { ReactNode } from "react";
import { AlertTriangle, Inbox, Loader2, Lock } from "lucide-react";
import { errorMessage, statusOf } from "@/lib/api";
import { Btn } from "./index";

export function LoadingState({ label = "Loading…", full }: { label?: string; full?: boolean }) {
  return (
    <div role="status" aria-live="polite" className={`flex items-center justify-center gap-3 text-muted text-[14px] ${full ? "min-h-[60vh]" : "py-16"}`}>
      <Loader2 size={18} className="animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function Skeleton({ className = "h-4 w-full" }: { className?: string }) {
  return <div className={`animate-pulse bg-ink/5 rounded-sm ${className}`} aria-hidden />;
}

export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="text-center py-14 px-6">
      <div className="mx-auto w-10 h-10 flex items-center justify-center text-faint">{icon ?? <Inbox size={28} strokeWidth={1.5} aria-hidden />}</div>
      <h3 className="font-serif text-[20px] text-ink mt-3">{title}</h3>
      {children && <p className="text-[14px] text-muted mt-2 max-w-[440px] mx-auto leading-relaxed">{children}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const status = statusOf(error);
  if (status === 403 || status === 404) {
    return (
      <EmptyState title={status === 404 ? "Not found" : "No access"} icon={<Lock size={26} strokeWidth={1.5} />}>
        {status === 404 ? "This item doesn't exist or you don't have access to it." : errorMessage(error)}
      </EmptyState>
    );
  }
  return (
    <div role="alert" className="text-center py-14 px-6">
      <AlertTriangle size={26} strokeWidth={1.5} className="mx-auto text-[#9F1D1D]" aria-hidden />
      <h3 className="font-serif text-[20px] text-ink mt-3">Couldn't load this</h3>
      <p className="text-[14px] text-muted mt-2">{errorMessage(error)}</p>
      {retry && (
        <Btn variant="secondary" size="sm" className="mt-5" onClick={retry}>
          Try again
        </Btn>
      )}
    </div>
  );
}

/** Render loading / error / empty / data states for a TanStack query. */
export function QueryView<T>({ query, children, empty, isEmpty }: { query: { data: T | undefined; isLoading: boolean; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode; empty?: ReactNode; isEmpty?: (d: T) => boolean }) {
  if (query.isLoading) return <LoadingState />;
  if (query.error) return <ErrorState error={query.error} retry={() => void query.refetch()} />;
  if (query.data === undefined) return null;
  const emptyCheck = isEmpty ?? ((d: T) => Array.isArray(d) && d.length === 0);
  if (empty && emptyCheck(query.data)) return <>{empty}</>;
  return <>{children(query.data)}</>;
}
