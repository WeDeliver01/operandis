import { ReactNode, useEffect } from "react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Container } from "./Container";
import { Nav } from "./Nav";
import { Footer } from "./Footer";

interface LegalLayoutProps {
  title: string;
  breadcrumb: string;
  lastUpdated: string;
  children: ReactNode;
}

export function LegalLayout({ title, breadcrumb, lastUpdated, children }: LegalLayoutProps) {
  useEffect(() => {
    document.title = `${title} — Operandi`;
  }, [title]);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main className="flex-grow">
        <section className="pt-40 pb-12 border-b hairline">
          <Container>
            <div className="max-w-[760px]">
              <Link
                href="/"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-muted hover:text-ink transition-colors mb-6"
              >
                <ArrowLeft size={14} strokeWidth={2} />
                Back to home
              </Link>
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
                <Link href="/" className="hover:text-ink transition-colors">OPERANDI</Link> / {breadcrumb}
              </div>
              <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
                {title}
              </h1>
              <p className="font-sans text-[14px] text-faint mt-6 uppercase tracking-wider">
                Last updated: {lastUpdated}
              </p>
            </div>
          </Container>
        </section>

        <section className="py-20">
          <Container>
            <article className="max-w-[760px] prose prose-lg prose-headings:font-serif prose-h2:text-[28px] prose-h2:font-medium prose-h2:mt-14 prose-h2:mb-4 prose-h2:text-ink prose-h3:text-[20px] prose-h3:font-medium prose-h3:mt-8 prose-h3:mb-3 prose-h3:text-ink prose-p:font-sans prose-p:text-[16px] prose-p:leading-[1.75] prose-p:text-muted prose-li:text-muted prose-li:text-[16px] prose-li:leading-[1.7] prose-strong:text-ink prose-a:text-ink prose-a:underline hover:prose-a:text-accent">
              {children}
            </article>
          </Container>
        </section>
      </main>
      <Footer />
    </div>
  );
}
