import { ReactNode, useEffect, useState, AnchorHTMLAttributes } from "react";
import { Container } from "./Container";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { BookCallButton } from "./BookCallButton";
import { Link } from "wouter";
import { MDXProvider } from "@mdx-js/react";
import { Screen } from "./mdx/Screen";
import { Detail } from "./mdx/Detail";
import { Stack } from "./mdx/Stack";
import { ArrowUpRight, Lock, ArrowLeft } from "lucide-react";

interface Meta {
  name: string;
  oneLiner: string;
  hero: string;
  sector: string;
  type: string;
  stack: string;
  status: string;
  site?: string;
  logo?: string;
  access?: string;
}

function ProductLogo({ src, alt }: { src: string; alt: string }) {
  const [error, setError] = useState(false);
  if (error) return null;
  return (
    <img
      src={src}
      alt={alt}
      className="h-10 w-10 object-contain mb-6"
      onError={() => setError(true)}
    />
  );
}

const components = {
  Screen,
  Detail,
  Stack,
  a: ({ href, children }: AnchorHTMLAttributes<HTMLAnchorElement>) => {
    if (href?.startsWith("/")) {
      return <Link href={href} className="text-ink underline hover:text-accent">{children}</Link>;
    }
    return <a href={href} className="text-ink underline hover:text-accent" target="_blank" rel="noopener noreferrer">{children}</a>;
  }
};

export function ProductPortraitLayout({ meta, children }: { meta: Meta; children: ReactNode }) {
  useEffect(() => {
    document.title = `${meta.name} — Operandis`;
    const ensureMeta = (name: string, attr: "name" | "property" = "name") => {
      let el = document.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute(attr, name);
        document.head.appendChild(el);
      }
      return el;
    };
    ensureMeta("description").setAttribute("content", meta.oneLiner);
    ensureMeta("og:title", "property").setAttribute("content", `${meta.name} — Operandis`);
    ensureMeta("og:description", "property").setAttribute("content", meta.oneLiner);
    ensureMeta("twitter:title").setAttribute("content", `${meta.name} — Operandis`);
    ensureMeta("twitter:description").setAttribute("content", meta.oneLiner);
  }, [meta.name, meta.oneLiner]);

  return (
    <div className="min-h-screen flex flex-col">
      <Nav />
      <main id="main" className="flex-grow pt-24 md:pt-28 pb-32">
        <Container>
          <div className="max-w-[720px] mx-auto mb-20">
            <Link
              href="/products"
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink transition-colors mb-6"
            >
              <ArrowLeft size={14} strokeWidth={2} />
              Back to all products
            </Link>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-6">
              OPERANDIS / <Link href="/products" className="hover:text-ink transition-colors">PRODUCTS</Link> / {meta.name}
            </div>
            {meta.logo && <ProductLogo src={meta.logo} alt={`${meta.name} logo`} />}
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-[1.1] tracking-tight mb-6">
              {meta.name}
            </h1>
            <p className="text-[18px] text-muted leading-relaxed max-w-[640px]">
              {meta.oneLiner}
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {meta.site ? (
                <a
                  href={meta.site}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 bg-ink text-white px-5 py-3 text-[13px] font-medium uppercase tracking-wider hover:bg-accent transition-colors rounded-sm"
                >
                  Visit {meta.site.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                  <ArrowUpRight size={16} strokeWidth={2} />
                </a>
              ) : meta.access ? (
                <div className="inline-flex items-center gap-2 text-[13px] text-muted bg-faint/20 border hairline px-4 py-2.5 rounded-sm">
                  <Lock size={14} strokeWidth={1.75} />
                  {meta.access}
                </div>
              ) : null}
            </div>
          </div>

          <div className="mb-20">
            <Screen src={meta.hero} caption="" hideCaptionIfEmpty />
          </div>

          <div className="max-w-[720px] mx-auto mb-24 grid grid-cols-2 md:grid-cols-4 gap-8 py-8 border-y hairline">
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-2">Sector</div>
              <div className="text-[14px] text-ink font-medium">{meta.sector}</div>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-2">Type</div>
              <div className="text-[14px] text-ink font-medium">{meta.type}</div>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-2">Stack</div>
              <div className="text-[14px] text-ink font-medium">{meta.stack}</div>
            </div>
            <div>
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-2">Status</div>
              <div className="text-[14px] text-ink font-medium">{meta.status}</div>
            </div>
          </div>

          <div className="max-w-[720px] mx-auto prose prose-lg prose-headings:font-serif prose-h2:text-[28px] prose-h2:font-medium prose-h2:mt-12 prose-h2:mb-4 prose-h3:text-[22px] prose-p:font-sans prose-p:text-[17px] prose-p:leading-[1.7] prose-p:text-muted prose-li:text-muted prose-strong:text-ink">
            <MDXProvider components={components}>
              {children}
            </MDXProvider>
          </div>

          <div className="max-w-[720px] mx-auto border-t hairline pt-16 mt-32 text-center">
            <h2 className="font-serif text-[28px] font-medium text-ink mb-4">
              Want something like this?
            </h2>
            <p className="text-[16px] text-muted max-w-[480px] mx-auto mb-8">
              We'd build a version shaped around your business. No two are the same.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-4">
              <Link href="/configure" className="inline-flex items-center gap-2 bg-ink text-white px-5 py-3 text-[13px] font-medium uppercase tracking-wider hover:bg-accent transition-colors rounded-sm">
                Configure a project
              </Link>
              <BookCallButton variant="secondary" />
              <Link
                href="/products"
                className="inline-flex items-center gap-2 border hairline text-ink px-5 py-3 text-[13px] font-medium uppercase tracking-wider hover:bg-ink hover:text-white transition-colors rounded-sm"
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to all products
              </Link>
            </div>
          </div>
        </Container>
      </main>
      <Footer />
    </div>
  );
}
