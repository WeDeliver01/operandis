import { useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { CheckoutResponse, OrderStatusDto } from "@workspace/api-zod";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { get, post, errorMessage } from "@/lib/api";
import { money } from "@/lib/format";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Btn, buttonClass } from "@/components/ui-kit";
import { EftInstructions, PaymentHandoff } from "@/components/commerce";

/**
 * Landing page after the hosted payment page. The browser redirect proves
 * nothing: we poll the order, whose status only changes on a verified
 * provider notification (webhook/ITN).
 */
export default function CheckoutReturn() {
  const search = new URLSearchParams(useSearch());
  const order = search.get("order") ?? "";
  const token = search.get("token") ?? "";
  const cancelled = search.get("cancelled") === "1";
  const [retry, setRetry] = useState<CheckoutResponse | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [polls, setPolls] = useState(0);

  const q = useQuery({
    queryKey: ["order-status", order],
    queryFn: async () => {
      setPolls((n) => n + 1);
      return get<OrderStatusDto>(`/checkout/orders/${encodeURIComponent(order)}?token=${encodeURIComponent(token)}`);
    },
    enabled: Boolean(order && token),
    refetchInterval: (query) => {
      const d = query.state.data;
      if (!d || d.status !== "pending_payment" || cancelled) return false;
      if (d.paymentStatus === "failed" || d.paymentStatus === "cancelled") return false;
      return polls < 40 ? 3000 : false;
    },
  });

  async function doRetry() {
    setBusy(true);
    setRetryError(null);
    try {
      setRetry(await post<CheckoutResponse>(`/checkout/orders/${encodeURIComponent(order)}/retry`, { token }));
    } catch (e) {
      setRetryError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  const s = q.data;
  const paid = s && s.status !== "pending_payment" && s.status !== "cancelled";
  const failed = s && s.status === "pending_payment" && (cancelled || ["failed", "cancelled", "expired"].includes(s.paymentStatus));
  const eftWaiting = s && s.provider === "eft" && s.status === "pending_payment" && !failed;

  return (
    <PageShell title="Payment status">
      <section className="pt-32 pb-24">
        <Container>
          <div className="max-w-[600px] mx-auto">
            {!order || !token ? (
              <ErrorState error={new Error("Missing order reference")} />
            ) : q.isLoading ? (
              <LoadingState label="Checking your payment…" />
            ) : q.error ? (
              <ErrorState error={q.error} retry={() => void q.refetch()} />
            ) : retry ? (
              retry.payment.eft ? <EftInstructions eft={retry.payment.eft} /> : <PaymentHandoff payment={retry.payment} />
            ) : paid ? (
              <div className="text-center">
                <CheckCircle2 size={44} strokeWidth={1.25} className="mx-auto text-[#1E6B3A]" aria-hidden />
                <h1 className="font-serif text-[36px] text-ink mt-4">Payment confirmed</h1>
                <p className="text-muted mt-3">
                  Order {s.orderReference}{s.packageName ? ` — ${s.packageName}` : ""}. We've emailed your receipt and a link to your client portal, where you can follow progress.
                </p>
                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                  <Link href="/portal" className={buttonClass("primary")}>Open client portal</Link>
                  <Link href="/" className={buttonClass("secondary")}>Back to home</Link>
                </div>
              </div>
            ) : failed ? (
              <div className="text-center">
                <XCircle size={44} strokeWidth={1.25} className="mx-auto text-[#9F1D1D]" aria-hidden />
                <h1 className="font-serif text-[36px] text-ink mt-4">Payment not completed</h1>
                <p className="text-muted mt-3">{s.failureReason ?? "The payment was cancelled or declined."} Nothing was charged. Your order {s.orderReference} is saved — you can try again.</p>
                {retryError && <Alert tone="danger" className="mt-4 text-left">{retryError}</Alert>}
                <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
                  {s.canRetry && <Btn loading={busy} onClick={doRetry}>Try again — {money(s.dueNowMinor)}</Btn>}
                  <Link href="/contact" className={buttonClass("secondary")}>Contact us</Link>
                </div>
              </div>
            ) : (
              <div className="text-center">
                <Clock size={44} strokeWidth={1.25} className="mx-auto text-muted" aria-hidden />
                <h1 className="font-serif text-[36px] text-ink mt-4">{eftWaiting ? "Awaiting your EFT" : "Confirming your payment…"}</h1>
                <p className="text-muted mt-3" aria-live="polite">
                  {eftWaiting
                    ? `Order ${s.orderReference} is reserved. We'll confirm it as soon as ${money(s.dueNowMinor)} reflects in our account.`
                    : "We're waiting for the payment provider to confirm. This usually takes a few seconds — you can safely leave this page; we'll email you either way."}
                </p>
                {!eftWaiting && polls >= 40 && (
                  <Btn variant="secondary" className="mt-6" onClick={() => { setPolls(0); void q.refetch(); }}>Check again</Btn>
                )}
              </div>
            )}
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
