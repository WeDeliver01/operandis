import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import type { PackageSummary } from "@workspace/api-zod";
import { PageShell, PageHero } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { usePackages, useServices, useFaqs } from "@/lib/queries";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Badge, buttonClass } from "@/components/ui-kit";
import { money } from "@/lib/format";

export function priceLabel(p: Pick<PackageSummary, "pricingMode" | "fromPriceMinor">) {
  if (p.pricingMode === "quote_only") return { prefix: "Priced by", value: "proposal" };
  return { prefix: p.pricingMode === "starting_from" ? "Starting from" : "From", value: money(p.fromPriceMinor) };
}

export function PackageCard({ p }: { p: PackageSummary }) {
  const price = priceLabel(p);
  return (
    <Link href={`/packages/${p.slug}`} className="group flex flex-col bg-white border hairline rounded-sm p-7 hover:shadow-ambient transition-shadow h-full">
      <div className="flex items-center gap-2 flex-wrap mb-4 min-h-[22px]">
        {p.isDiscovery && <Badge tone="accent">Discovery</Badge>}
        {p.status === "paused" && <Badge tone="warning">Paused</Badge>}
        {p.soldOut && <Badge tone="warning">Fully booked</Badge>}
        {p.audience !== "both" && <Badge>{p.audience === "b2b" ? "Business" : "Individuals"}</Badge>}
      </div>
      <h3 className="font-serif text-[24px] font-medium text-ink group-hover:text-accent transition-colors">{p.name}</h3>
      <p className="text-[15px] text-muted mt-3 leading-relaxed flex-grow">{p.summary}</p>
      <div className="mt-6 pt-5 border-t hairline flex items-end justify-between gap-4">
        <div>
          <div className="text-[12px] uppercase tracking-wider text-faint">{price.prefix}</div>
          <div className="font-serif text-[24px] text-ink">{price.value}</div>
        </div>
        <div className="text-right">
          <div className="text-[12px] uppercase tracking-wider text-faint">Delivery</div>
          <div className="text-[14px] text-ink">{p.deliveryWindow || "Agreed in scope"}</div>
        </div>
      </div>
      <span className="inline-flex items-center gap-1 mt-5 text-[14px] font-medium text-ink group-hover:text-accent">
        View package <ArrowRight size={14} />
      </span>
    </Link>
  );
}

export default function Packages() {
  const packages = usePackages();
  const services = useServices();
  const faqs = useFaqs("packages");
  const [cat, setCat] = useState("all");
  const filtered = useMemo(() => (packages.data ?? []).filter((p) => cat === "all" || p.categorySlug === cat), [packages.data, cat]);
  const cats = (services.data ?? []).filter((s) => (packages.data ?? []).some((p) => p.categorySlug === s.slug));

  return (
    <PageShell title="Packages" description="Productised software development packages with published scope, timelines and prices — websites, e-commerce, portals, integrations and more.">
      <PageHero
        eyebrow="Operandis / Packages"
        title="Software packages with the price on the label."
        actions={
          <Link href="/configure" className={buttonClass("secondary")}>
            Need something custom? Configure a project
          </Link>
        }
      >
        Fixed-scope packages you can buy online, with inclusions, exclusions, delivery windows and payment terms spelled out before you commit. Anything bigger starts with a proposal.
      </PageHero>

      <section className="pb-20">
        <Container>
          {cats.length > 1 && (
            <div role="group" aria-label="Filter packages" className="flex flex-wrap gap-2 mb-10">
              {[{ slug: "all", name: "All packages" }, ...cats].map((c) => (
                <button key={c.slug} type="button" aria-pressed={cat === c.slug} onClick={() => setCat(c.slug)} className={`text-[13px] px-3.5 py-1.5 rounded-sm border transition-colors ${cat === c.slug ? "bg-ink text-paper border-ink" : "border-rule text-ink hover:border-ink"}`}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          <QueryView query={{ ...packages, data: packages.data ? filtered : undefined }} empty={<EmptyState title="No packages published yet">Our package catalogue is being finalised. Meanwhile, configure a custom project or book a call.</EmptyState>}>
            {(list) => (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {list.map((p) => (
                  <PackageCard key={p.slug} p={p} />
                ))}
              </div>
            )}
          </QueryView>
        </Container>
      </section>

      {(faqs.data?.length ?? 0) > 0 && (
        <section className="py-20 border-t hairline">
          <Container>
            <h2 className="font-serif text-[32px] font-medium text-ink mb-10">Buying a package</h2>
            <dl className="max-w-[800px] divide-y hairline border-y hairline">
              {faqs.data!.map((f) => (
                <div key={f.id} className="py-6">
                  <dt className="font-serif text-[20px] text-ink">{f.question}</dt>
                  <dd className="text-[16px] text-muted mt-2 leading-relaxed">{f.answer}</dd>
                </div>
              ))}
            </dl>
          </Container>
        </section>
      )}
    </PageShell>
  );
}
