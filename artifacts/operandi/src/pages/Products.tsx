import { useMemo, useState } from "react";
import { Link } from "wouter";
import { Lock } from "lucide-react";
import { PageShell, PageHero } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { PortfolioTile } from "@/components/ProductTile";
import { usePortfolio, useServices, STATUS_LABELS } from "@/lib/queries";
import { LoadingState } from "@/components/ui-kit/states";
import { buttonClass } from "@/components/ui-kit";

/** Portfolio catalogue (/work and the original /products URL). Data comes from the CMS. */
export default function Products() {
  const portfolio = usePortfolio();
  const services = useServices();
  const [category, setCategory] = useState<string>("all");

  const all = portfolio.data ?? [];
  const filtered = useMemo(() => (category === "all" ? all : all.filter((p) => p.serviceCategorySlugs.includes(category))), [all, category]);
  const flagship = filtered.filter((p) => p.featured);
  const supporting = filtered.filter((p) => !p.featured);
  const usedCategories = (services.data ?? []).filter((s) => all.some((p) => p.serviceCategorySlugs.includes(s.slug)));

  return (
    <PageShell title="Our work" description="Production systems Operandis has designed, shipped and run: SaaS platforms, customer portals, storefronts and internal tools.">
      <PageHero eyebrow="Operandis / Work" title="Some of what we've built.">
        A preview of our flagship builds: production systems we designed, shipped, and run ourselves. Click any one to read how it's built. There's more we can't show publicly; ask us about it on a call.
      </PageHero>

      {usedCategories.length > 0 && (
        <section className="pb-8">
          <Container>
            <div role="group" aria-label="Filter by service" className="flex flex-wrap gap-2">
              {[{ slug: "all", name: "All work" }, ...usedCategories].map((c) => (
                <button
                  key={c.slug}
                  type="button"
                  aria-pressed={category === c.slug}
                  onClick={() => setCategory(c.slug)}
                  className={`text-[13px] px-3.5 py-1.5 rounded-sm border transition-colors ${category === c.slug ? "bg-ink text-paper border-ink" : "border-rule text-ink hover:border-ink"}`}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="pb-16 md:pb-20">
        <Container>
          {portfolio.isLoading ? (
            <LoadingState />
          ) : flagship.length + supporting.length === 0 ? (
            <p className="text-muted py-10">No projects in this category yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8">
              {flagship.map((p) => (
                <PortfolioTile key={p.slug} p={p} />
              ))}
            </div>
          )}
        </Container>
      </section>

      {supporting.length > 0 && (
        <section className="pb-20 md:pb-24">
          <Container>
            <div className="max-w-[860px]">
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">Also in the workshop</div>
              <h2 className="font-serif text-[28px] md:text-[36px] font-medium text-ink leading-tight">Supporting builds.</h2>
              <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                Shorter writeups on other systems we've shipped: internal tools and niche products that don't need the full portrait treatment, but show the range of what we take on.
              </p>
            </div>
            <div className="mt-12 divide-y hairline border-y hairline">
              {supporting.map((p) => (
                <Link key={p.slug} href={`/products/${p.slug}`} className="group flex flex-col md:flex-row md:items-center gap-6 py-8 transition-colors -mx-4 px-4 rounded-sm">
                  <div className="flex-shrink-0 w-20 h-20 bg-white border hairline rounded-sm flex items-center justify-center overflow-hidden">
                    {p.logoUrl ? <img src={p.logoUrl} alt={`${p.title} logo`} className="max-w-[70%] max-h-[70%] object-contain" /> : <span className="font-serif text-[20px] font-medium text-ink">{p.title.charAt(0)}</span>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3 flex-wrap">
                      <h3 className="font-serif text-[22px] md:text-[24px] font-medium text-ink group-hover:text-accent transition-colors">{p.title}</h3>
                      <span className="inline-flex items-center gap-1 text-[11px] uppercase tracking-wider text-faint border hairline px-2 py-0.5 rounded-sm">
                        {p.statusLabel === "internal_tool" && <Lock size={11} />} {STATUS_LABELS[p.statusLabel]}
                      </span>
                    </div>
                    <p className="font-sans text-[15px] text-muted mt-2 leading-relaxed max-w-[640px]">{p.shortDescription}</p>
                  </div>
                  <div className="md:flex-shrink-0">
                    <span className="inline-flex items-center text-[14px] font-medium text-ink group-hover:text-accent group-hover:underline transition-colors">Read the build &rarr;</span>
                  </div>
                </Link>
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="py-20 border-t hairline">
        <Container>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <h2 className="font-serif text-[28px] md:text-[36px] font-medium text-ink">Want something like this?</h2>
              <p className="text-muted mt-2 max-w-[560px]">Describe the problem in plain language and get an indicative assessment in about ten minutes.</p>
            </div>
            <div className="flex flex-col sm:flex-row gap-3">
              <Link href="/configure" className={buttonClass("primary")}>Configure a project</Link>
              <Link href="/packages" className={buttonClass("secondary")}>Browse packages</Link>
            </div>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
