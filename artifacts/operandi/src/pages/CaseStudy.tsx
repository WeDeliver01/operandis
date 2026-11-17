import { useEffect } from "react";
import { Link } from "wouter";
import ReactMarkdown from "react-markdown";
import { ArrowLeft, ArrowUpRight, Lock } from "lucide-react";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { Screen } from "@/components/mdx/Screen";
import { usePortfolioProject, STATUS_LABELS } from "@/lib/queries";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { buttonClass } from "@/components/ui-kit";
import { trackEvent } from "@/lib/analytics";

/**
 * CMS-driven case study for portfolio entries without a bundled MDX body.
 * Markdown is rendered without raw HTML (react-markdown escapes it), so CMS
 * content cannot inject scripts.
 */
export default function CaseStudy({ params }: { params: { slug: string } }) {
  const q = usePortfolioProject(params.slug);
  useEffect(() => {
    trackEvent("portfolio_project_viewed", { entityType: "portfolio", entityId: params.slug });
  }, [params.slug]);
  const p = q.data;

  return (
    <PageShell title={p?.seoTitle ?? p?.title} description={p?.seoDescription ?? p?.shortDescription}>
      <div className="pt-24 md:pt-28 pb-32">
        <Container>
          {q.isLoading ? (
            <LoadingState full />
          ) : q.error || !p ? (
            <ErrorState error={q.error} />
          ) : (
            <>
              <div className="max-w-[720px] mx-auto mb-16">
                <Link href="/work" className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink mb-6">
                  <ArrowLeft size={14} /> Back to all work
                </Link>
                {p.logoUrl && <img src={p.logoUrl} alt={`${p.title} logo`} className="h-10 w-10 object-contain mb-6" />}
                <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-[1.1] tracking-tight mb-6">{p.title}</h1>
                <p className="text-[18px] text-muted leading-relaxed">{p.shortDescription}</p>
                <div className="mt-8 flex flex-wrap items-center gap-4">
                  {p.externalUrl ? (
                    <a href={p.externalUrl} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "md")}>
                      Visit {p.externalUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")} <ArrowUpRight size={16} />
                    </a>
                  ) : p.accessNote ? (
                    <div className="inline-flex items-center gap-2 text-[13px] text-muted border hairline px-4 py-2.5 rounded-sm">
                      <Lock size={14} /> {p.accessNote}
                    </div>
                  ) : null}
                </div>
              </div>

              {p.heroUrl && (
                <div className="mb-16">
                  <Screen src={p.heroUrl} caption="" hideCaptionIfEmpty />
                </div>
              )}

              <div className="max-w-[720px] mx-auto mb-16 grid grid-cols-2 md:grid-cols-4 gap-8 py-8 border-y hairline">
                {[
                  ["Sector", p.industry],
                  ["Type", p.projectType],
                  ["Stack", p.stack],
                  ["Status", STATUS_LABELS[p.statusLabel]],
                ].map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-2">{k}</div>
                    <div className="text-[14px] text-ink font-medium">{v || "—"}</div>
                  </div>
                ))}
              </div>

              <article className="max-w-[720px] mx-auto prose prose-lg prose-headings:font-serif prose-h2:text-[28px] prose-h2:font-medium prose-p:text-[17px] prose-p:leading-[1.7] prose-p:text-muted prose-li:text-muted prose-strong:text-ink">
                {p.challenge && (
                  <>
                    <h2>The challenge</h2>
                    <ReactMarkdown>{p.challenge}</ReactMarkdown>
                  </>
                )}
                {p.approach && (
                  <>
                    <h2>Our approach</h2>
                    <ReactMarkdown>{p.approach}</ReactMarkdown>
                  </>
                )}
                {p.solution && (
                  <>
                    <h2>The solution</h2>
                    <ReactMarkdown>{p.solution}</ReactMarkdown>
                  </>
                )}
                {p.features.length > 0 && (
                  <>
                    <h2>Key features</h2>
                    <ul>
                      {p.features.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                {p.outcomes.length > 0 && (
                  <>
                    <h2>Outcomes</h2>
                    <ul>
                      {p.outcomes.map((f) => (
                        <li key={f}>{f}</li>
                      ))}
                    </ul>
                  </>
                )}
                {p.bodyMarkdown && <ReactMarkdown>{p.bodyMarkdown}</ReactMarkdown>}
                {p.testimonial && (
                  <blockquote>
                    <p>“{p.testimonial.quote}”</p>
                    <footer className="text-[14px] not-italic">
                      — {p.testimonial.author}
                      {p.testimonial.role ? `, ${p.testimonial.role}` : ""}
                      {p.testimonial.company ? `, ${p.testimonial.company}` : ""}
                    </footer>
                  </blockquote>
                )}
              </article>

              {p.gallery.length > 0 && (
                <div className="mt-16 grid grid-cols-1 md:grid-cols-2 gap-6">
                  {p.gallery.map((g) => (
                    <Screen key={g.url} src={g.url} caption={g.caption} />
                  ))}
                </div>
              )}

              <div className="max-w-[720px] mx-auto border-t hairline pt-16 mt-24 text-center">
                <h2 className="font-serif text-[28px] font-medium text-ink mb-4">Want something like this?</h2>
                <p className="text-[16px] text-muted max-w-[480px] mx-auto mb-8">We'd build a version shaped around your business. No two are the same.</p>
                <div className="flex flex-wrap items-center justify-center gap-4">
                  <Link href="/configure" className={buttonClass("primary")}>Configure a project</Link>
                  <Link href="/work" className={buttonClass("secondary")}>Back to all work</Link>
                </div>
              </div>
            </>
          )}
        </Container>
      </div>
    </PageShell>
  );
}
