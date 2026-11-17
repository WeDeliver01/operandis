import { useEffect } from "react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";

export default function Services() {
  useEffect(() => {
    document.title = "Services — Operandi";
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDI / SERVICES
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              What we build.
            </h1>
            <p className="font-sans text-[18px] text-muted max-w-[640px] mt-4 leading-relaxed">
              Most of our work falls into one of four shapes. None of them are off-the-shelf.
            </p>
          </Container>
        </section>

        <section className="pb-32">
          <Container>
            <div className="border-t hairline py-20">
              <div className="text-[12px] font-medium text-faint uppercase tracking-wider">01 / INTERNAL TOOLS</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Internal tools and ops platforms.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  We replace the tangle of spreadsheets, Notion pages, and WhatsApp groups your team is using to run the business with one tool, built to match your actual workflow.
                </p>
                <p>
                  From dispatch routing and inventory control to custom CRMs and compliance trackers, we build surfaces that help your team work faster and make fewer mistakes.
                </p>
              </div>
            </div>

            <div className="border-t hairline py-20">
              <div className="text-[12px] font-medium text-faint uppercase tracking-wider">02 / CUSTOMER PLATFORMS</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Customer-facing platforms.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  Storefronts, marketplaces, and portals: the software your customers log into. Built to work on a phone first, to handle real volume, and to integrate cleanly with whatever you already use.
                </p>
                <p>
                  We design interfaces that feel fast, clear, and branded, hiding the complexity of the operational machinery behind the scenes.
                </p>
              </div>
            </div>

            <div className="border-t hairline py-20">
              <div className="text-[12px] font-medium text-faint uppercase tracking-wider">03 / SAAS PRODUCTS</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Multi-tenant SaaS products.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  The software you sell, not just the software you use. Tenants, plans, billing, RBAC, integrations, admin. We've shipped two of these; see WeShip and Airhouse.
                </p>
                <p>
                  We handle the boilerplate of building a software product so you can focus on the core value proposition for your early adopters.
                </p>
              </div>
            </div>

            <div className="border-t hairline py-20 border-b">
              <div className="text-[12px] font-medium text-faint uppercase tracking-wider">04 / INTEGRATIONS</div>
              <h2 className="font-serif text-[32px] font-medium text-ink mt-4">Integrations and automation.</h2>
              <div className="font-sans text-[18px] text-muted mt-6 max-w-[720px] space-y-4 leading-relaxed">
                <p>
                  The plumbing between the tools you already pay for: your store, your payments, your couriers, your accounting, your messaging. Fewer humans copy-pasting between tabs.
                </p>
                <p>
                  We build robust, idempotent sync engines that ensure your data stays correct across all your systems, even when APIs fail.
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
