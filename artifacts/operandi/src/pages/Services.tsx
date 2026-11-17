import { Link } from "wouter";
import { ArrowRight } from "lucide-react";
import { PageShell, PageHero } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { useServices, usePackages, usePortfolio } from "@/lib/queries";
import { LoadingState } from "@/components/ui-kit/states";
import { buttonClass } from "@/components/ui-kit";
import { money } from "@/lib/format";

/** Fallback copy (the original static page) if the CMS is unreachable. */
const FALLBACK = [
  { slug: "internal-tools", eyebrow: "01 / Internal tools", headline: "Internal tools and ops platforms.", summary: "We replace the tangle of spreadsheets, Notion pages, and WhatsApp groups your team is using to run the business with one tool, built to match your actual workflow.", description: "From dispatch routing and inventory control to custom CRMs and compliance trackers, we build surfaces that help your team work faster and make fewer mistakes.", audiences: [], deliverables: [] },
  { slug: "customer-platforms", eyebrow: "02 / Customer platforms", headline: "Customer-facing platforms.", summary: "Storefronts, marketplaces, and portals: the software your customers log into. Built to work on a phone first, to handle real volume, and to integrate cleanly with whatever you already use.", description: "We design interfaces that feel fast, clear, and branded, hiding the complexity of the operational machinery behind the scenes.", audiences: [], deliverables: [] },
  { slug: "saas-products", eyebrow: "03 / SaaS products", headline: "Multi-tenant SaaS products.", summary: "The software you sell, not just the software you use. Tenants, plans, billing, RBAC, integrations, admin. We've shipped two of these; see WeShip and Airhouse.", description: "We handle the boilerplate of building a software product so you can focus on the core value proposition for your early adopters.", audiences: [], deliverables: [] },
  { slug: "integrations", eyebrow: "04 / Integrations", headline: "Integrations and automation.", summary: "The plumbing between the tools you already pay for: your store, your payments, your couriers, your accounting, your messaging. Fewer humans copy-pasting between tabs.", description: "We build robust, idempotent sync engines that ensure your data stays correct across all your systems, even when APIs fail.", audiences: [], deliverables: [] },
];

export default function Services() {
  const services = useServices();
  const packages = usePackages();
  const portfolio = usePortfolio();
  const list = services.data ?? (services.isError ? FALLBACK : []);

  return (
    <PageShell title="Services" description="Custom software development services: internal tools, customer platforms, SaaS products, integrations, websites, e-commerce and mobile apps.">
      <PageHero eyebrow="Operandis / Services" title="What we build.">
        Most of our work falls into a handful of shapes. None of them are off-the-shelf. Each one can start as a fixed-price package or a custom project.
      </PageHero>

      <section className="pb-24">
        <Container>
          {services.isLoading && <LoadingState />}
          {list.map((s, i) => {
            const related = (packages.data ?? []).filter((p) => p.categorySlug === s.slug && p.status === "published");
            const work = (portfolio.data ?? []).filter((p) => p.serviceCategorySlugs.includes(s.slug));
            return (
              <div key={s.slug} id={s.slug} className={`border-t hairline py-16 md:py-20 ${i === list.length - 1 ? "border-b" : ""} scroll-mt-24`}>
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-10 lg:gap-16">
                  <div>
                    <div className="text-[12px] font-medium text-faint uppercase tracking-wider">{s.eyebrow}</div>
                    <h2 className="font-serif text-[30px] md:text-[32px] font-medium text-ink mt-4">{s.headline}</h2>
                    <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                      <p>{s.summary}</p>
                      {s.description && <p>{s.description}</p>}
                    </div>
                    {(s.audiences.length > 0 || s.deliverables.length > 0) && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-8 mt-10 max-w-[720px]">
                        {s.audiences.length > 0 && (
                          <div>
                            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">Who it's for</div>
                            <ul className="space-y-1.5 text-[15px] text-ink">{s.audiences.map((a) => <li key={a}>{a}</li>)}</ul>
                          </div>
                        )}
                        {s.deliverables.length > 0 && (
                          <div>
                            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">What you get</div>
                            <ul className="space-y-1.5 text-[15px] text-ink">{s.deliverables.map((a) => <li key={a}>{a}</li>)}</ul>
                          </div>
                        )}
                      </div>
                    )}
                    {work.length > 0 && (
                      <p className="text-[14px] text-muted mt-8">
                        Related work:{" "}
                        {work.map((w, wi) => (
                          <span key={w.slug}>
                            <Link href={`/products/${w.slug}`} className="text-ink underline underline-offset-4 hover:text-accent">{w.title}</Link>
                            {wi < work.length - 1 ? ", " : ""}
                          </span>
                        ))}
                      </p>
                    )}
                  </div>
                  <aside aria-label={`Ways to start with ${s.headline}`} className="lg:pt-8">
                    <div className="bg-white border hairline rounded-sm p-6">
                      <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">Ways to start</div>
                      {related.length > 0 ? (
                        <ul className="divide-y hairline">
                          {related.map((p) => (
                            <li key={p.slug}>
                              <Link href={`/packages/${p.slug}`} className="flex items-baseline justify-between gap-3 py-3 group">
                                <span className="text-[15px] text-ink group-hover:text-accent">{p.name}</span>
                                <span className="text-[13px] text-muted whitespace-nowrap">{p.pricingMode === "quote_only" ? "On proposal" : `from ${money(p.fromPriceMinor)}`}</span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-[14px] text-muted">Every project in this area is scoped to your business.</p>
                      )}
                      <Link href="/configure" className={buttonClass("primary", "sm", "w-full mt-5")}>
                        Configure a project <ArrowRight size={14} />
                      </Link>
                    </div>
                  </aside>
                </div>
              </div>
            );
          })}
        </Container>
      </section>
    </PageShell>
  );
}
