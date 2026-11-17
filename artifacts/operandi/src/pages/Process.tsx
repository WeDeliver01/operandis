import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";

export default function Process() {
  useEffect(() => {
    document.title = "Process — Operandis";
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main id="main" className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDIS / PROCESS
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              How we work.
            </h1>
            <p className="font-sans text-[18px] text-muted max-w-[640px] mt-4 leading-relaxed">
              We don't pitch. We listen, scope, and build.
            </p>
          </Container>
        </section>

        <section className="pb-32">
          <Container>
            <div className="border-t hairline py-20">
              <div className="font-serif text-[64px] font-medium text-ink">1</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Listen.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  A free working session, up to an hour. You explain the problem in plain language. We ask sharp questions and sketch what software around it might look like. No slides, no upsell. You'll leave with a clearer picture either way.
                </p>
                <p>
                  This isn't a sales call. It's a diagnostic session to figure out if custom software is actually the right lever for your business to pull right now. Sometimes an off-the-shelf tool really is better.
                </p>
              </div>
            </div>

            <div className="border-t hairline py-20">
              <div className="font-serif text-[64px] font-medium text-ink">2</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Scope.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  Within a week, you get a written proposal: what we'd build, what it costs, how long it takes, what we need from you. Fixed scope, fixed price.
                </p>
                <p>
                  We don't do open-ended hourly billing that shifts the risk onto you. The proposal lays out the exact features for version one, so there are no surprises midway through the project.
                </p>
              </div>
            </div>

            <div className="border-t hairline py-20 border-b">
              <div className="font-serif text-[64px] font-medium text-ink">3</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Build and ship.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  We build in weeks, not quarters. Weekly check-ins, working software at every checkpoint. When it's done, the code is yours.
                </p>
                <p>
                  We handle the deployment, the database setup, the domains, and the emails. Once launched, you can keep us on retainer for support and new features, or take the codebase entirely in-house.
                </p>
              </div>
            </div>
          </Container>
        </section>
      </main>
      <Footer />
    </div>
  );
}
