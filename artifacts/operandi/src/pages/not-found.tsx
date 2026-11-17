import { Link } from "wouter";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { buttonClass } from "@/components/ui-kit";

export default function NotFound() {
  return (
    <PageShell title="Page not found">
      <section className="pt-40 pb-32">
        <Container>
          <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">404</div>
          <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight">This page doesn't exist.</h1>
          <p className="text-[18px] text-muted mt-4 max-w-[560px]">It may have moved, or the link may be incomplete.</p>
          <div className="mt-8 flex flex-col sm:flex-row gap-3">
            <Link href="/" className={buttonClass("primary")}>Back to home</Link>
            <Link href="/work" className={buttonClass("secondary")}>See our work</Link>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}
