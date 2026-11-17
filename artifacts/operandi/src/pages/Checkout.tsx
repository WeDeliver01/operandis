import { useEffect, useMemo, useState } from "react";
import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Lock } from "lucide-react";
import type { CheckoutResponse, PackageQuoteDto } from "@workspace/api-zod";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { usePackage } from "@/lib/queries";
import { usePublicSettings } from "@/lib/settings";
import { useAuth } from "@/lib/auth";
import { get, post, errorMessage, fieldErrors, newIdempotencyKey, problemOf } from "@/lib/api";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Btn, Checkbox, ChoiceCard, TextField } from "@/components/ui-kit";
import { EftInstructions, PaymentHandoff, PriceBreakdown } from "@/components/commerce";
import { selectionFromQuery } from "./PackageDetail";

interface Provider {
  key: "payfast" | "yoco" | "eft";
  label: string;
  default: boolean;
}

export default function Checkout({ params }: { params: { slug: string } }) {
  const search = useSearch();
  const selection = useMemo(() => selectionFromQuery(search), [search]);
  const expectedVersion = Number(new URLSearchParams(search).get("v")) || undefined;
  const submissionReference = new URLSearchParams(search).get("brief") ?? undefined;
  const pkg = usePackage(params.slug);
  const settings = usePublicSettings();
  const { me } = useAuth();
  const quote = useQuery({ queryKey: ["quote", params.slug, selection], queryFn: () => post<PackageQuoteDto>(`/packages/${params.slug}/quote`, selection), retry: false });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => get<Provider[]>("/checkout/providers") });

  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", vatNumber: "", line1: "", city: "", postalCode: "", acceptTerms: false, website: "" });
  const [provider, setProvider] = useState<Provider["key"] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [result, setResult] = useState<CheckoutResponse | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  // One idempotency key per checkout attempt on this page: double clicks and retries can't create two orders.
  const [idempotencyKey] = useState(() => newIdempotencyKey("checkout"));

  useEffect(() => {
    if (me) setForm((f) => ({ ...f, name: f.name || me.name, email: f.email || me.email, phone: f.phone || me.phone || "", company: f.company || me.organizations[0]?.name || "" }));
  }, [me]);
  useEffect(() => {
    if (providers.data && !provider) setProvider((providers.data.find((p) => p.default) ?? providers.data[0])?.key ?? null);
  }, [providers.data, provider]);

  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setForm({ ...form, [k]: e.target.type === "checkbox" ? Boolean(e.target.checked) : e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    setNeedsSignIn(false);
    try {
      const res = await post<CheckoutResponse>("/checkout/sessions", {
        packageSlug: params.slug,
        expectedVersion,
        selection,
        billing: {
          name: form.name,
          email: form.email,
          phone: form.phone || undefined,
          company: form.company || undefined,
          vatNumber: form.vatNumber || undefined,
          address: form.line1 ? { line1: form.line1, city: form.city, postalCode: form.postalCode, country: "ZA" } : undefined,
        },
        acceptTerms: form.acceptTerms || undefined,
        termsVersion: settings.commerce.termsVersion,
        provider: provider ?? undefined,
        submissionReference,
        idempotencyKey,
        website: form.website || undefined,
      });
      setResult(res);
    } catch (err) {
      const p = problemOf(err);
      if (p?.code === "account_exists") setNeedsSignIn(true);
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  if (pkg.isLoading || quote.isLoading) return <PageShell title="Checkout"><LoadingState full /></PageShell>;
  if (pkg.error || !pkg.data) return <PageShell title="Checkout"><div className="pt-32"><ErrorState error={pkg.error} /></div></PageShell>;
  const p = pkg.data;

  if (result) {
    return (
      <PageShell title="Payment">
        <section className="pt-32 pb-24">
          <Container>
            <div className="max-w-[560px] mx-auto space-y-6">
              <h1 className="font-serif text-[36px] text-ink">Order {result.orderReference}</h1>
              {result.payment.provider === "eft" && result.payment.eft ? (
                <>
                  <EftInstructions eft={result.payment.eft} />
                  <Alert tone="info">
                    We've emailed you these details and a link to your client portal, where you can upload proof of payment.{" "}
                    <Link href={`/checkout/return?order=${result.orderReference}&token=${result.accessToken}`} className="underline">Check order status</Link>
                  </Alert>
                </>
              ) : (
                <PaymentHandoff payment={result.payment} />
              )}
            </div>
          </Container>
        </section>
      </PageShell>
    );
  }

  const blocked = !quote.data?.purchasable;
  const noProviders = providers.data && providers.data.length === 0;

  return (
    <PageShell title={`Checkout — ${p.name}`}>
      <section className="pt-28 pb-24">
        <Container>
          <Link href={`/packages/${p.slug}`} className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink mb-6">
            <ArrowLeft size={14} /> Back to package
          </Link>
          <h1 className="font-serif text-[36px] md:text-[44px] font-semibold text-ink">Checkout</h1>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12 mt-10 items-start">
            <form onSubmit={submit} className="space-y-10 min-w-0" noValidate>
              {!me && (
                <p className="text-[14px] text-muted">
                  Already a client? <Link href={`/login?next=${encodeURIComponent(`/checkout/${params.slug}?${search}`)}`} className="underline text-ink">Sign in</Link> first. Otherwise check out as a guest — we'll create your client portal access automatically.
                </p>
              )}
              <fieldset className="space-y-4">
                <legend className="font-serif text-[22px] text-ink mb-4">Billing details</legend>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <TextField label="Full name" required value={form.name} onChange={set("name")} autoComplete="name" error={errors["billing.name"]} />
                  <TextField label="Email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" disabled={Boolean(me)} error={errors["billing.email"]} hint="Receipts and portal access are sent here." />
                  <TextField label="Phone" value={form.phone} onChange={set("phone")} autoComplete="tel" error={errors["billing.phone"]} />
                  <TextField label="Company (optional)" value={form.company} onChange={set("company")} autoComplete="organization" />
                  <TextField label="VAT number (optional)" value={form.vatNumber} onChange={set("vatNumber")} />
                  <TextField label="Street address (optional)" value={form.line1} onChange={set("line1")} autoComplete="street-address" />
                  <TextField label="City" value={form.city} onChange={set("city")} autoComplete="address-level2" />
                  <TextField label="Postal code" value={form.postalCode} onChange={set("postalCode")} autoComplete="postal-code" />
                </div>
              </fieldset>

              <fieldset>
                <legend className="font-serif text-[22px] text-ink mb-4">Payment method</legend>
                {noProviders ? (
                  <Alert tone="warning">Online payment isn't available yet. Please request a proposal from the package page.</Alert>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Payment method">
                    {(providers.data ?? []).map((pr) => (
                      <ChoiceCard key={pr.key} type="radio" name="provider" selected={provider === pr.key} onToggle={() => setProvider(pr.key)} title={pr.label} description={pr.key === "eft" ? "Bank transfer. Confirmed once funds clear (1–2 working days)." : "Secure hosted payment page. We never see your card details."} />
                    ))}
                  </div>
                )}
              </fieldset>

              <fieldset className="space-y-4">
                <legend className="font-serif text-[22px] text-ink mb-2">Scope & terms</legend>
                <div className="bg-white border hairline rounded-sm p-5 text-[14px] text-muted space-y-2 leading-relaxed">
                  <p><strong className="text-ink font-medium">You're buying:</strong> {p.name}{selection.variantKey ? ` — ${p.variants.find((v) => v.key === selection.variantKey)?.name}` : ""}. Delivery {p.deliveryWindow || "as agreed in scope"}.</p>
                  {p.exclusions.length > 0 && <p><strong className="text-ink font-medium">Not included:</strong> {p.exclusions.join("; ")}.</p>}
                  {p.cancellationTerms && <p><strong className="text-ink font-medium">Cancellation & refunds:</strong> {p.cancellationTerms}</p>}
                  {settings.commerce.refundPolicySummary && <p>{settings.commerce.refundPolicySummary}</p>}
                </div>
                <Checkbox
                  checked={form.acceptTerms}
                  onChange={set("acceptTerms")}
                  label={
                    <>
                      I accept the package scope above and the <Link href="/terms" className="underline">Terms of Service</Link> (version {settings.commerce.termsVersion || "current"}), and I've read the <Link href="/privacy" className="underline">Privacy Policy</Link>.
                    </>
                  }
                  error={errors.acceptTerms}
                />
                <input type="text" name="website" value={form.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
              </fieldset>

              {error && (
                <Alert tone="danger" title="We couldn't start your payment">
                  {error}
                  {needsSignIn && (
                    <div className="mt-2">
                      <Link href={`/login?next=${encodeURIComponent(`/checkout/${params.slug}?${search}`)}`} className="underline font-medium">Sign in to continue</Link>
                    </div>
                  )}
                </Alert>
              )}
              <Btn type="submit" size="lg" loading={busy} disabled={blocked || !form.acceptTerms || !provider || !form.name || !form.email} className="w-full sm:w-auto">
                <Lock size={14} /> {provider === "eft" ? "Place order & get EFT details" : "Pay securely"}
              </Btn>
            </form>

            <aside className="lg:sticky lg:top-28 bg-white border hairline rounded-sm p-6" aria-label="Order summary">
              <h2 className="font-serif text-[20px] text-ink">{p.name}</h2>
              {quote.data ? <PriceBreakdown quote={quote.data} /> : <Alert tone="warning" className="mt-3">{errorMessage(quote.error)}</Alert>}
              {blocked && quote.data && <Alert tone="info" className="mt-4">{quote.data.requiresQuoteReasons.join(" ") || "This selection needs a proposal."}</Alert>}
              <p className="text-[12px] text-faint mt-5">Amounts are recalculated on our server when you place the order. Payment is only marked successful once the payment provider confirms it.</p>
            </aside>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
