import { useEffect, type ReactNode } from "react";
import { Nav } from "./Nav";
import { Footer } from "./Footer";
import { Container } from "./Container";
import { useBrand } from "@/lib/settings";

/** Standard public page frame: nav, main landmark, footer, document title. */
export function PageShell({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  const brand = useBrand();
  useEffect(() => {
    document.title = title ? `${title} — ${brand}` : `${brand} — Software development studio`;
    if (description) {
      let el = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (!el) {
        el = document.createElement("meta");
        el.name = "description";
        document.head.appendChild(el);
      }
      el.content = description;
    }
  }, [title, description, brand]);
  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main id="main" className="flex-grow">
        {children}
      </main>
      <Footer />
    </div>
  );
}

export function PageHero({ eyebrow, title, children, actions }: { eyebrow: string; title: ReactNode; children?: ReactNode; actions?: ReactNode }) {
  return (
    <section className="pt-32 pb-12 md:pb-16">
      <Container>
        <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">{eyebrow}</div>
        <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight max-w-[900px]">{title}</h1>
        {children && <div className="font-sans text-[18px] text-muted max-w-[680px] mt-4 leading-relaxed">{children}</div>}
        {actions && <div className="flex flex-col sm:flex-row gap-3 mt-8">{actions}</div>}
      </Container>
    </section>
  );
}
