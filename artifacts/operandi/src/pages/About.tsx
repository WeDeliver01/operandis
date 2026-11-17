import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";

export default function About() {
  useEffect(() => {
    document.title = "About — Operandi";
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDI / ABOUT
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              About Operandi.
            </h1>
          </Container>
        </section>

        <section className="pb-32">
          <Container>
            <div className="flex flex-col md:flex-row gap-16 md:gap-12 border-t hairline pt-20">
              <div className="md:w-[60%] font-sans text-[18px] text-ink leading-[1.65] space-y-6">
                <p>
                  <em>Modus operandi:</em> the way someone operates. The name is the point. Every business we work with has a way of operating that nothing on the shelf can match. We design software around that, not the other way around.
                </p>
                <p>
                  We build fast, because we use modern tools and we don't waste your time. We build well, because we've already shipped production systems across logistics, finance, property, retail, and CRM. The flagship builds on this site are a sample of that work. We know what breaks because we've broken it and fixed it ourselves. That's a different kind of credibility than a case-study deck.
                </p>
                <p>
                  Operandi is a custom software studio based in Pretoria, South Africa. We work with founders, operators, and teams globally who need digital infrastructure that works exactly the way they do.
                </p>
              </div>

              <div className="md:w-[40%]">
                <div className="bg-gray-50/50 p-8 border hairline rounded-sm">
                  <h3 className="font-serif text-[22px] font-medium text-ink mb-6">Contact</h3>
                  <div className="space-y-4">
                    <div>
                      <div className="text-[12px] font-medium text-faint uppercase tracking-wider mb-1">EMAIL</div>
                      <a href="mailto:hello@operandi.studio" className="text-[15px] text-ink hover:text-accent transition-colors underline">hello@operandi.studio</a>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium text-faint uppercase tracking-wider mb-1">LOCATION</div>
                      <div className="text-[15px] text-ink">Pretoria, South Africa</div>
                    </div>
                    <div>
                      <div className="text-[12px] font-medium text-faint uppercase tracking-wider mb-1">NETWORK</div>
                      <a href="#" className="text-[15px] text-ink hover:text-accent transition-colors underline">LinkedIn</a>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </div>
  );
}
