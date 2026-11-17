import { useEffect, useRef } from "react";
import { Check, Circle, Clock } from "lucide-react";
import type { PackageQuoteDto, PaymentRedirect } from "@workspace/api-zod";
import { money, date } from "@/lib/format";
import { StatusBadge } from "./ui-kit";

export function PriceBreakdown({ quote, loading }: { quote: PackageQuoteDto; loading?: boolean }) {
  return (
    <div className={loading ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
      <ul className="mt-3 space-y-2 text-[14px]">
        {quote.lines.map((l) => (
          <li key={`${l.kind}-${l.key}`} className="flex justify-between gap-4">
            <span className="text-muted">{l.description}</span>
            <span className="text-ink whitespace-nowrap">{l.totalMinor ? money(l.totalMinor) : "—"}</span>
          </li>
        ))}
      </ul>
      <div className="border-t hairline mt-4 pt-4 space-y-1.5 text-[14px]">
        {quote.taxMinor > 0 && (
          <>
            <div className="flex justify-between"><span className="text-muted">Subtotal</span><span>{money(quote.subtotalMinor)}</span></div>
            <div className="flex justify-between"><span className="text-muted">{quote.taxLabel ?? "Tax"}</span><span>{money(quote.taxMinor)}</span></div>
          </>
        )}
        <div className="flex justify-between items-baseline">
          <span className="text-ink font-medium">Total</span>
          <span className="font-serif text-[28px] text-ink" aria-live="polite">{money(quote.totalMinor)}</span>
        </div>
        <div className="flex justify-between"><span className="text-muted">Due now</span><span className="text-ink font-medium">{money(quote.dueNowMinor)}</span></div>
        {quote.balanceMinor > 0 && <div className="flex justify-between"><span className="text-muted">Balance on delivery</span><span>{money(quote.balanceMinor)}</span></div>}
      </div>
    </div>
  );
}

/** Hand off to a hosted payment page. PayFast requires a form POST; Yoco a redirect. */
export function PaymentHandoff({ payment }: { payment: PaymentRedirect }) {
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (payment.method === "POST") formRef.current?.submit();
    else if (payment.method === "GET" && payment.url) window.location.assign(payment.url);
  }, [payment]);
  if (payment.method === "POST" && payment.url && payment.fields) {
    return (
      <form ref={formRef} method="post" action={payment.url} className="text-center">
        {Object.entries(payment.fields).map(([k, v]) => (
          <input key={k} type="hidden" name={k} value={v} />
        ))}
        <p className="text-muted text-[14px]">Redirecting you to our secure payment partner…</p>
        <button type="submit" className="mt-4 underline text-ink">Continue to payment</button>
      </form>
    );
  }
  if (payment.method === "GET" && payment.url) {
    return (
      <p className="text-center text-muted text-[14px]">
        Redirecting to secure payment… <a href={payment.url} className="underline text-ink">Continue</a>
      </p>
    );
  }
  return null;
}

export function EftInstructions({ eft }: { eft: NonNullable<PaymentRedirect["eft"]> }) {
  const rows: [string, string][] = [
    ["Bank", eft.bankName],
    ["Account name", eft.accountName],
    ["Account number", eft.accountNumber],
    ["Branch code", eft.branchCode],
    ["Account type", eft.accountType],
    ["Payment reference", eft.reference],
    ["Amount", money(eft.amountMinor, { decimals: true })],
  ];
  return (
    <div className="bg-white border hairline rounded-sm p-6">
      <h3 className="font-serif text-[20px] text-ink">Pay by EFT</h3>
      <p className="text-[14px] text-muted mt-1">Use the reference exactly as shown so we can match your payment. Your order is confirmed once the funds reflect in our account.</p>
      <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-muted">{k}</dt>
            <dd className="text-ink font-medium break-all">{v || "—"}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export interface TimelineMilestone {
  id: string;
  title: string;
  description?: string;
  status: string;
  targetDate?: string | Date | null;
  completedAt?: string | Date | null;
  amountMinor?: number;
}

export function MilestoneTimeline({ items, actions }: { items: TimelineMilestone[]; actions?: (m: TimelineMilestone) => React.ReactNode }) {
  return (
    <ol className="relative border-l hairline ml-3">
      {items.map((m) => {
        const done = m.status === "completed";
        const active = m.status === "in_progress" || m.status === "awaiting_approval";
        return (
          <li key={m.id} className="ml-6 pb-7 last:pb-0">
            <span className={`absolute -left-[11px] flex h-[22px] w-[22px] items-center justify-center rounded-full border ${done ? "bg-ink border-ink text-paper" : active ? "bg-paper border-ink text-ink" : "bg-paper border-rule text-faint"}`} aria-hidden>
              {done ? <Check size={12} /> : active ? <Clock size={12} /> : <Circle size={8} />}
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[15px] font-medium text-ink">{m.title}</h4>
              <StatusBadge status={m.status} />
              {m.amountMinor ? <span className="text-[13px] text-muted">{money(m.amountMinor)}</span> : null}
            </div>
            {m.description && <p className="text-[14px] text-muted mt-1">{m.description}</p>}
            <p className="text-[12px] text-faint mt-1">{done ? `Completed ${date(m.completedAt)}` : m.targetDate ? `Target ${date(m.targetDate)}` : "Date to be confirmed"}</p>
            {actions && <div className="mt-2">{actions(m)}</div>}
          </li>
        );
      })}
    </ol>
  );
}

export function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div>
      <div className="h-1.5 bg-ink/10 rounded-full overflow-hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} aria-label={label ?? "Progress"}>
        <div className="h-full bg-ink transition-all" style={{ width: `${Math.min(100, Math.max(0, value))}%` }} />
      </div>
    </div>
  );
}
