import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, Minus } from "lucide-react";
import type { PackageDetail as Pkg, PackageQuoteDto, PackageSelectionInput } from "@workspace/api-zod";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { usePackage } from "@/lib/queries";
import { post, errorMessage } from "@/lib/api";
import { money, percent } from "@/lib/format";
import { trackEvent, attribution } from "@/lib/analytics";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, ChoiceCard, Checkbox, TextArea, TextField, buttonClass } from "@/components/ui-kit";
import { Modal } from "@/components/ui-kit/overlay";
import { PriceBreakdown } from "@/components/commerce";

export function selectionToQuery(sel: PackageSelectionInput) {
  const q = new URLSearchParams();
  if (sel.variantKey) q.set("tier", sel.variantKey);
  for (const o of sel.options ?? []) q.append("addon", `${o.key}:${o.quantity}`);
  return q.toString();
}

export function selectionFromQuery(search: string): PackageSelectionInput {
  const q = new URLSearchParams(search);
  return {
    variantKey: q.get("tier"),
    options: q.getAll("addon").map((a) => {
      const [key, qty] = a.split(":");
      return { key, quantity: Math.max(1, Number(qty) || 1) };
    }),
  };
}

function depositText(p: Pkg) {
  switch (p.deposit.type) {
    case "full":
      return "Paid in full at checkout.";
    case "none":
      return "Invoiced on delivery.";
    case "percent":
      return `${percent(p.deposit.percentBps)} deposit at checkout, balance on delivery.`;
    case "fixed":
      return `${money(p.deposit.amountMinor)} deposit at checkout, balance on delivery.`;
  }
}

export default function PackageDetail({ params }: { params: { slug: string } }) {
  const q = usePackage(params.slug);
  const p = q.data;
  const [, navigate] = useLocation();
  const [variantKey, setVariantKey] = useState<string | null>(null);
  const [options, setOptions] = useState<Record<string, number>>({});
  const [enquiryOpen, setEnquiryOpen] = useState(false);

  useEffect(() => {
    if (!p) return;
    trackEvent("package_viewed", { entityType: "package", entityId: p.slug });
    if (!variantKey && p.variants.length) setVariantKey((p.variants.find((v) => v.recommended) ?? p.variants[0]).key);
  }, [p]); // eslint-disable-line react-hooks/exhaustive-deps

  const selection: PackageSelectionInput = useMemo(() => ({ variantKey, options: Object.entries(options).map(([key, quantity]) => ({ key, quantity })) }), [variantKey, options]);
  const quote = useQuery({
    queryKey: ["quote", params.slug, selection],
    queryFn: () => post<PackageQuoteDto>(`/packages/${params.slug}/quote`, selection),
    enabled: Boolean(p) && p!.status === "published" && (p!.variants.length === 0 || Boolean(variantKey)),
    retry: false,
    placeholderData: (prev) => prev,
  });

  if (q.isLoading) return <PageShell><LoadingState full /></PageShell>;
  if (q.error || !p) return <PageShell title="Package"><div className="pt-32"><ErrorState error={q.error} /></div></PageShell>;

  const toggleOption = (key: string, on: boolean, qty = 1) =>
    setOptions((prev) => {
      const next = { ...prev };
      if (on) next[key] = qty;
      else delete next[key];
      return next;
    });

  const purchasable = p.status === "published" && !p.soldOut && quote.data?.purchasable;
  const proposalOnly = p.pricingMode === "quote_only";

  return (
    <PageShell title={p.name} description={p.summary}>
      <section className="pt-28 pb-10">
        <Container>
          <Link href="/packages" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink mb-6">
            <ArrowLeft size={14} /> All packages
          </Link>
          <div className="flex flex-wrap gap-2 mb-4">
            {p.isDiscovery && <Badge tone="accent">Discovery</Badge>}
            {p.status === "paused" && <Badge tone="warning">Sales paused</Badge>}
            {p.soldOut && <Badge tone="warning">Fully booked</Badge>}
          </div>
          <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight max-w-[880px]">{p.name}</h1>
          <p className="text-[18px] text-muted max-w-[720px] mt-4 leading-relaxed">{p.summary}</p>
        </Container>
      </section>

      <section className="pb-24">
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_380px] gap-12 items-start">
            <div className="min-w-0 space-y-14">
              {p.description && <p className="text-[17px] text-ink leading-[1.7] max-w-[720px] whitespace-pre-line">{p.description}</p>}

              {p.variants.length > 0 && (
                <div>
                  <h2 className="font-serif text-[26px] text-ink mb-5">Choose a tier</h2>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4" role="radiogroup" aria-label="Package tier">
                    {p.variants.map((v) => (
                      <ChoiceCard
                        key={v.key}
                        type="radio"
                        name="tier"
                        selected={variantKey === v.key}
                        onToggle={() => setVariantKey(v.key)}
                        title={<>{v.name}</>}
                        badge={v.recommended ? <Badge tone="accent">Popular</Badge> : undefined}
                        description={
                          <>
                            <span className="block font-serif text-[20px] text-ink mt-1">{money(v.priceMinor)}</span>
                            <span className="block mt-1">{v.description}</span>
                            {v.deliveryWindow && <span className="block mt-1">Delivery {v.deliveryWindow}</span>}
                            {v.inclusions.length > 0 && (
                              <ul className="mt-2 space-y-1">
                                {v.inclusions.map((i) => (
                                  <li key={i} className="flex gap-1.5"><Check size={13} className="mt-1 shrink-0" />{i}</li>
                                ))}
                              </ul>
                            )}
                          </>
                        }
                      />
                    ))}
                  </div>
                </div>
              )}

              {p.options.length > 0 && (
                <div>
                  <h2 className="font-serif text-[26px] text-ink mb-5">Add-ons</h2>
                  <div className="space-y-3">
                    {p.options.map((o) => {
                      const selected = o.key in options;
                      const incompatible = (o.rules.variants.length > 0 && (!variantKey || !o.rules.variants.includes(variantKey))) || o.rules.excludes.some((e) => e in options);
                      return (
                        <div key={o.key} className="flex flex-col sm:flex-row sm:items-center gap-3">
                          <div className="flex-1">
                            <ChoiceCard
                              selected={selected}
                              disabled={incompatible && !selected}
                              onToggle={() => toggleOption(o.key, !selected, Math.max(1, o.minQty))}
                              title={o.label}
                              badge={o.pricingType === "manual_review" ? <Badge tone="warning">Priced on review</Badge> : <span className="text-[14px] text-muted font-normal">{money(o.amountMinor)}{o.pricingType === "per_unit" && o.unitLabel ? ` / ${o.unitLabel}` : ""}</span>}
                              description={
                                <>
                                  {o.description}
                                  {o.rules.requires.length > 0 && <span className="block mt-1">Requires: {o.rules.requires.map((r) => p.options.find((x) => x.key === r)?.label ?? r).join(", ")}</span>}
                                  {o.rules.variants.length > 0 && <span className="block mt-1">Available with: {o.rules.variants.map((r) => p.variants.find((x) => x.key === r)?.name ?? r).join(", ")}</span>}
                                </>
                              }
                            />
                          </div>
                          {selected && o.pricingType === "per_unit" && (
                            <label className="flex items-center gap-2 text-[13px] text-muted sm:w-[140px]">
                              Qty
                              <input type="number" min={Math.max(1, o.minQty)} max={o.maxQty} value={options[o.key]} onChange={(e) => toggleOption(o.key, true, Math.min(o.maxQty, Math.max(1, Number(e.target.value) || 1)))} className="w-20 bg-white border border-rule rounded-sm px-2 py-2 text-ink" aria-label={`${o.label} quantity`} />
                            </label>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <ListBlock title="What's included" items={[...p.deliverables, ...p.inclusions]} icon="check" />
                <ListBlock title="Not included" items={p.exclusions} icon="minus" />
                <ListBlock title="What we need from you" items={p.clientResponsibilities} icon="check" />
                <ListBlock title="What happens next" items={p.nextSteps} numbered />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 border-y hairline py-8">
                {[
                  ["Delivery window", p.deliveryWindow || "Agreed in scope"],
                  ["Revisions", p.revisions || "—"],
                  ["Warranty & support", p.warrantySupport || "—"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[12px] uppercase tracking-wider text-faint mb-1">{k}</div>
                    <div className="text-[15px] text-ink">{v}</div>
                  </div>
                ))}
              </div>
              {p.eligibility && <p className="text-[14px] text-muted"><strong className="text-ink font-medium">Who it's for: </strong>{p.eligibility}</p>}
              {p.cancellationTerms && (
                <div>
                  <h2 className="font-serif text-[22px] text-ink mb-2">Cancellation & refunds</h2>
                  <p className="text-[15px] text-muted leading-relaxed max-w-[720px]">{p.cancellationTerms}</p>
                </div>
              )}
              {p.faqs.length > 0 && (
                <div>
                  <h2 className="font-serif text-[26px] text-ink mb-4">Questions</h2>
                  <dl className="divide-y hairline border-y hairline">
                    {p.faqs.map((f) => (
                      <div key={f.id} className="py-5">
                        <dt className="font-medium text-ink">{f.question}</dt>
                        <dd className="text-muted mt-1.5 leading-relaxed">{f.answer}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            </div>

            <aside className="lg:sticky lg:top-28" aria-label="Price summary">
              <div className="bg-white border hairline rounded-sm p-6">
                <div className="text-[12px] uppercase tracking-wider text-faint">{proposalOnly ? "Typical starting point" : p.pricingMode === "starting_from" ? "Starting from" : "Your price"}</div>
                {proposalOnly ? (
                  <>
                    <div className="font-serif text-[30px] text-ink mt-1">On proposal</div>
                    <p className="text-[14px] text-muted mt-2">This work is always scoped to your business. Configure your project for an indicative range, or request a proposal.</p>
                  </>
                ) : quote.data ? (
                  <PriceBreakdown quote={quote.data} loading={quote.isFetching} />
                ) : quote.error ? (
                  <Alert tone="warning" className="mt-3">{errorMessage(quote.error)}</Alert>
                ) : p.status === "paused" ? (
                  <div className="font-serif text-[30px] text-ink mt-1">from {money(p.fromPriceMinor)}</div>
                ) : (
                  <LoadingState label="Calculating…" />
                )}
                {!proposalOnly && <p className="text-[13px] text-muted mt-4">{depositText(p)}</p>}
                {quote.data && quote.data.requiresQuoteReasons.length > 0 && (
                  <Alert tone="info" className="mt-4">{quote.data.requiresQuoteReasons.join(" ")}</Alert>
                )}
                <div className="mt-6 flex flex-col gap-3">
                  {purchasable && (
                    <Btn size="lg" onClick={() => navigate(`/checkout/${p.slug}?${selectionToQuery(selection)}&v=${p.version}`)}>
                      Continue to checkout
                    </Btn>
                  )}
                  {proposalOnly || !purchasable ? (
                    <>
                      <Link href="/configure" className={buttonClass(purchasable ? "secondary" : "primary", "lg")}>Configure your project</Link>
                      <Btn variant="secondary" size="lg" onClick={() => setEnquiryOpen(true)}>Request a proposal</Btn>
                    </>
                  ) : (
                    <Btn variant="ghost" onClick={() => setEnquiryOpen(true)}>Have questions? Request a proposal</Btn>
                  )}
                </div>
                <p className="text-[12px] text-faint mt-5 leading-relaxed">Prices in South African rand. The final price is always calculated on our server at checkout.</p>
              </div>
            </aside>
          </div>
        </Container>
      </section>
      <EnquiryModal open={enquiryOpen} onOpenChange={setEnquiryOpen} pkg={p} selection={selection} />
    </PageShell>
  );
}

function ListBlock({ title, items, icon, numbered }: { title: string; items: string[]; icon?: "check" | "minus"; numbered?: boolean }) {
  if (!items.length) return null;
  return (
    <div>
      <h2 className="font-serif text-[22px] text-ink mb-4">{title}</h2>
      <ul className="space-y-2.5">
        {items.map((it, i) => (
          <li key={it} className="flex gap-2.5 text-[15px] text-ink leading-relaxed">
            <span className="mt-1 text-muted shrink-0" aria-hidden>
              {numbered ? <span className="text-[13px] font-medium">{i + 1}.</span> : icon === "minus" ? <Minus size={14} /> : <Check size={14} />}
            </span>
            {it}
          </li>
        ))}
      </ul>
    </div>
  );
}

function EnquiryModal({ open, onOpenChange, pkg, selection }: { open: boolean; onOpenChange: (v: boolean) => void; pkg: Pkg; selection: PackageSelectionInput }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", message: "", consentProcessing: false, consentMarketing: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setForm({ ...form, [k]: e.target.type === "checkbox" ? Boolean(e.target.checked) : e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await post<{ reference: string }>(`/packages/${pkg.slug}/enquiries`, { ...form, consentProcessing: form.consentProcessing || undefined, selection, attribution: attribution() });
      setDone(r.reference);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open={open} onOpenChange={onOpenChange} title={`Request a proposal: ${pkg.name}`} description="We'll reply within two working days with questions or a written proposal.">
      {done ? (
        <Alert tone="success" title="Thanks — we've got it.">Your reference is {done}. Check your inbox for a confirmation.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <TextField label="Name" required value={form.name} onChange={set("name")} autoComplete="name" />
            <TextField label="Email" type="email" required value={form.email} onChange={set("email")} autoComplete="email" />
            <TextField label="Phone" value={form.phone} onChange={set("phone")} autoComplete="tel" />
            <TextField label="Company" value={form.company} onChange={set("company")} autoComplete="organization" />
          </div>
          <TextArea label="Anything we should know?" value={form.message} onChange={set("message")} rows={3} />
          <input type="text" name="website" value={form.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
          <Checkbox label="I consent to Operandis processing these details to respond to my enquiry." checked={form.consentProcessing} onChange={set("consentProcessing")} />
          <Checkbox label="Send me occasional updates (optional)." checked={form.consentMarketing} onChange={set("consentMarketing")} />
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end">
            <Btn type="submit" loading={busy} disabled={!form.consentProcessing || !form.name || !form.email}>Send request</Btn>
          </div>
        </form>
      )}
    </Modal>
  );
}
