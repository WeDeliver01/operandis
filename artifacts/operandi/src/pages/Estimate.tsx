import { Link, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import type { EstimateView } from "@workspace/api-zod";
import type { EstimateResult } from "@workspace/domain";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { get } from "@/lib/api";
import { money, moneyRange, percent, date } from "@/lib/format";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Badge, buttonClass } from "@/components/ui-kit";
import { BookCallButton } from "@/components/BookCallButton";

const CONFIDENCE_TEXT = { high: "High confidence", medium: "Medium confidence", low: "Low confidence" } as const;

export function EstimateSummary({ view, showCtas = true }: { view: EstimateView; showCtas?: boolean }) {
  const r = view.result as EstimateResult | null;
  return (
    <div className="space-y-12">
      <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
        <span>Reference <strong className="text-ink font-medium">{view.submissionReference}</strong></span>
        <span aria-hidden>·</span>
        <span>{date(view.createdAt)}</span>
        {view.rulesVersion && (
          <>
            <span aria-hidden>·</span>
            <span>Pricing rules v{view.rulesVersion}</span>
          </>
        )}
        {view.isDemoPricing && <Badge tone="warning">Demonstration pricing</Badge>}
      </div>

      {!r || !r.priced ? (
        <div className="bg-white border hairline rounded-sm p-8">
          <h2 className="font-serif text-[28px] text-ink">Thanks — your brief is with our team</h2>
          <p className="text-muted mt-3 leading-relaxed max-w-[640px]">
            {r ? "Your answers describe a problem that needs a short conversation before we can put numbers to it." : "We'll review your brief and come back within two working days with a recommended next step."} We've emailed you a copy.
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-px bg-rule border hairline rounded-sm overflow-hidden">
            <div className="bg-white p-6 md:col-span-2">
              <div className="text-[12px] uppercase tracking-wider text-faint">Indicative investment</div>
              <div className="font-serif text-[36px] md:text-[44px] text-ink leading-tight mt-1">{moneyRange(r.lowMinor, r.highMinor)}</div>
              <div className="text-[14px] text-muted mt-2">
                {r.taxLabel ? `excl. ${r.taxLabel}` : "Excluding third-party fees"} · <Badge tone={r.confidence === "high" ? "success" : r.confidence === "medium" ? "info" : "warning"}>{CONFIDENCE_TEXT[r.confidence]}</Badge>
              </div>
            </div>
            <div className="bg-white p-6">
              <div className="text-[12px] uppercase tracking-wider text-faint">Indicative timeline</div>
              <div className="font-serif text-[30px] text-ink mt-1">{r.timeline.minWeeks}–{r.timeline.maxWeeks} weeks</div>
              <div className="text-[13px] text-muted mt-2">From kick-off, subject to discovery and your inputs.</div>
            </div>
          </div>

          <div>
            <h2 className="font-serif text-[26px] text-ink">Recommended solution</h2>
            <p className="text-[17px] text-ink mt-2">{r.recommendedSolution}</p>
            <div className="flex flex-wrap gap-2 mt-4">
              {[...view.summary.solutionLabels, ...view.summary.platformLabels].map((l) => (
                <Badge key={l}>{l}</Badge>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
            <div>
              <h2 className="font-serif text-[22px] text-ink mb-4">How it adds up</h2>
              <ul className="divide-y hairline border-y hairline text-[14px]">
                {r.lineItems.map((li) => (
                  <li key={`${li.category}-${li.key}`} className="flex justify-between gap-4 py-2.5">
                    <span className="text-muted">{li.label}</span>
                    <span className="text-ink whitespace-nowrap">{money(li.amountMinor)}</span>
                  </li>
                ))}
                <li className="flex justify-between gap-4 py-3 font-medium">
                  <span>Point estimate (rounded)</span>
                  <span>{money(r.totalMinor)}</span>
                </li>
              </ul>
              <p className="text-[12px] text-faint mt-2">The range reflects the confidence of the estimate: wider when there's more to confirm.</p>
            </div>
            <div>
              <h2 className="font-serif text-[22px] text-ink mb-4">Indicative payment plan</h2>
              <ul className="divide-y hairline border-y hairline text-[14px]">
                {r.milestones.map((m) => (
                  <li key={m.key} className="flex justify-between gap-4 py-2.5">
                    <span>
                      <span className="text-ink">{m.label}</span>
                      {m.description && <span className="block text-[12px] text-muted">{m.description}</span>}
                    </span>
                    <span className="text-ink whitespace-nowrap">{percent(m.percentBps)} · {money(m.amountMinor)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[14px] text-muted mt-4">
                Recommended deposit: <strong className="text-ink font-medium">{money(r.depositMinor)}</strong> ({percent(r.depositPercentBps)}).
                {r.discoveryFeeMinor > 0 && <> Discovery is charged separately: <strong className="text-ink font-medium">{money(r.discoveryFeeMinor)}</strong>.</>}
              </p>
            </div>
          </div>
        </>
      )}

      {r && r.flags.length > 0 && (
        <div className="bg-[#FBF1E1] border border-[#F1DDB8] rounded-sm p-6">
          <h2 className="flex items-center gap-2 font-serif text-[20px] text-ink"><AlertTriangle size={18} aria-hidden /> Worth a conversation</h2>
          <p className="text-[14px] text-muted mt-1">These answers need a person to look at them before a firm quote — they often change scope or cost.</p>
          <ul className="mt-3 space-y-1.5 text-[14px] text-ink list-disc pl-5">
            {r.flags.map((f) => (
              <li key={f.code}>{f.message}</li>
            ))}
          </ul>
        </div>
      )}

      {r && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 text-[14px]">
          {[
            ["Assumptions", r.assumptions],
            ["Not included", r.exclusions],
            ["Third-party costs", r.thirdPartyNotes],
          ].map(([title, items]) => (
            <div key={title as string}>
              <h3 className="font-serif text-[18px] text-ink mb-2">{title as string}</h3>
              <ul className="space-y-1.5 text-muted list-disc pl-5">
                {(items as string[]).map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <p className="flex gap-2 text-[13px] text-muted border-t hairline pt-6 leading-relaxed">
        <Info size={16} className="shrink-0 mt-0.5" aria-hidden />
        {r?.statement ?? "This assessment is indicative and non-binding until discovery and a written proposal."} Changes after scope approval go through change control.
      </p>

      {showCtas && (
        <div className="bg-ink text-paper rounded-sm p-8 md:p-10">
          <h2 className="font-serif text-[28px]">Your next step</h2>
          <p className="text-paper/80 mt-2 max-w-[620px]">
            {r?.recommendation === "package"
              ? "Your brief fits one of our fixed-scope packages — you can buy it online today."
              : r?.recommendation === "paid_discovery"
                ? "We recommend a short discovery sprint to confirm scope and fix the price before you commit to the build."
                : "Book a free 30-minute call to talk it through. No slides, no upsell."}
          </p>
          <div className="mt-6 flex flex-col sm:flex-row gap-3">
            {r?.recommendation === "package" && r.recommendedPackageSlug && (
              <Link href={`/packages/${r.recommendedPackageSlug}`} className="inline-flex justify-center items-center bg-paper text-ink px-6 py-3 text-[13px] font-medium uppercase tracking-wider rounded-sm hover:bg-white">
                View recommended package
              </Link>
            )}
            {view.discoveryPackageSlug && (
              <Link href={`/checkout/${view.discoveryPackageSlug}?brief=${view.submissionReference}`} className={`inline-flex justify-center items-center px-6 py-3 text-[13px] font-medium uppercase tracking-wider rounded-sm ${r?.recommendation === "paid_discovery" ? "bg-paper text-ink hover:bg-white" : "border border-paper/60 text-paper hover:bg-paper hover:text-ink"}`}>
                Book paid discovery
              </Link>
            )}
            <BookCallButton className="inline-flex justify-center items-center border border-paper/60 text-paper px-6 py-3 text-[13px] font-medium uppercase tracking-wider rounded-sm hover:bg-paper hover:text-ink cursor-pointer">
              Book a free call
            </BookCallButton>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Estimate({ params }: { params: { reference: string } }) {
  const search = new URLSearchParams(useSearch());
  const token = search.get("token") ?? "";
  const isNew = search.get("new") === "1";
  const q = useQuery({ queryKey: ["estimate", params.reference, token], queryFn: () => get<EstimateView>(`/configurator/estimates/${encodeURIComponent(params.reference)}?token=${encodeURIComponent(token)}`), enabled: Boolean(token) });

  return (
    <PageShell title="Your project assessment">
      <section className="pt-28 pb-24">
        <Container>
          <div className="max-w-[920px]">
            {isNew && (
              <Alert tone="success" className="mb-8" title="Brief received">
                <span className="inline-flex items-center gap-1.5"><CheckCircle2 size={14} /> We've emailed you a copy of this assessment and a private link to come back to it.</span>
              </Alert>
            )}
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">Preliminary project assessment</div>
            <h1 className="font-serif text-[36px] md:text-[52px] font-semibold text-ink leading-tight mb-10">{q.data ? `For ${q.data.summary.company || q.data.summary.name}` : "Your assessment"}</h1>
            {!token ? <ErrorState error={{ status: 404 }} /> : q.isLoading ? <LoadingState /> : q.error || !q.data ? <ErrorState error={q.error} /> : <EstimateSummary view={q.data} />}
            <div className="mt-10">
              <Link href="/configure" className={buttonClass("link")}>Start another brief</Link>
            </div>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
