import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";
import { ProductTile } from "@/components/ProductTile";
import { BookCallButton } from "@/components/BookCallButton";
import { Plus } from "lucide-react";
import { flagshipProducts, supportingProducts } from "@/content/products";

export default function Home() {
  useEffect(() => {
    document.title = "Operandi — Custom software for operators";
  }, []);

  const [openFaq, setOpenFaq] = useState<number | null>(null);

  const faqs = [
    {
      q: "Do you work with non-technical founders?",
      a: "Yes. Most of our clients are operators, not engineers. We translate."
    },
    {
      q: "Do I own the code?",
      a: "Yes. Fully. We hand over the repository, the database, the infrastructure, and the documentation. No lock-in."
    },
    {
      q: "How long does a project take?",
      a: "Most projects ship in 4 to 12 weeks. Larger platforms run 3 to 6 months. We'll commit to a date in the scope."
    },
    {
      q: "What does it cost?",
      a: "Smaller tools and integrations start around R50,000. Custom platforms and ops systems typically run R150,000 and up. We work on fixed-price scopes. After our first call, you'll get a written proposal with the price and the timeline. No hourly billing, no surprise invoices."
    },
    {
      q: "Do you maintain what you build?",
      a: "Yes. After launch, you can keep us on a monthly retainer for bug fixes, new features, and on-call support. Or you take it in-house. Your call."
    }
  ];

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      
      <main className="flex-grow">
        {/* Section 1 - Hero */}
        <section className="pt-40 md:pt-32 md:min-h-[80vh] flex flex-col justify-center pb-20">
          <Container>
            <h1 className="font-serif text-[40px] md:text-[80px] font-semibold text-ink leading-[1.05] tracking-tight max-w-[900px]">
              We build the software your business stands on.
            </h1>
            <p className="font-sans text-[17px] md:text-[20px] text-muted max-w-[620px] mt-6 leading-relaxed">
              Custom internal tools, customer platforms, and operational systems for operators who've outgrown spreadsheets and off-the-shelf software.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 mt-10">
              <Link href="/products" className="inline-flex justify-center items-center bg-ink text-white px-6 py-3 text-[14px] font-medium uppercase tracking-wider transition-colors hover:bg-accent rounded-sm">
                See our work
              </Link>
              <BookCallButton variant="secondary" />
            </div>
          </Container>
        </section>

        {/* Section 2 - Trust Strip */}
        <section className="border-y hairline py-10 flex items-center justify-center">
          <Container>
            <p className="text-[13px] text-faint uppercase tracking-wider text-center max-w-[800px] mx-auto">
              Built for businesses in logistics, financial services, property, e-commerce, and retail.
            </p>
          </Container>
        </section>

        {/* Section 3 - Products we've built */}
        <section className="py-20 md:py-24">
          <Container>
            <h2 className="font-serif text-[32px] md:text-[40px] font-medium text-ink">Some of what we've built</h2>
            <p className="font-sans text-[17px] text-muted mt-4 max-w-[720px]">
              A preview of our flagship work: production systems we designed, shipped, and run ourselves. Not the full catalogue, but enough to show the shape of what we can build for you.
            </p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mt-16">
              {flagshipProducts.map((product) => (
                <ProductTile key={product.slug} {...product} />
              ))}
            </div>

            <div className="mt-8 text-right">
              <Link href="/products" className="inline-flex items-center text-[15px] font-medium text-ink hover:underline hover:text-accent transition-colors">
                See {supportingProducts.length} more builds &rarr;
              </Link>
            </div>
          </Container>
        </section>

        {/* Section 4 - What we build */}
        <section className="py-20 md:py-24 border-t hairline">
          <Container>
            <h2 className="font-serif text-[32px] md:text-[40px] font-medium text-ink">What we build</h2>
            <p className="font-sans text-[17px] text-muted mt-4">
              Most of our work falls into one of four shapes. None of them are off-the-shelf.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-2 mt-16 border-t hairline border-l hairline">
              <div className="p-10 md:py-12 md:px-10 border-b hairline border-r hairline">
                <div className="text-[12px] font-medium text-faint uppercase tracking-wider">01 / INTERNAL TOOLS</div>
                <h3 className="font-serif text-[24px] font-medium text-ink mt-3">Internal tools and ops platforms.</h3>
                <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                  We replace the tangle of spreadsheets, Notion pages, and WhatsApp groups your team is using to run the business with one tool, built to match your actual workflow.
                </p>
              </div>
              <div className="p-10 md:py-12 md:px-10 border-b hairline border-r hairline">
                <div className="text-[12px] font-medium text-faint uppercase tracking-wider">02 / CUSTOMER PLATFORMS</div>
                <h3 className="font-serif text-[24px] font-medium text-ink mt-3">Customer-facing platforms.</h3>
                <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                  Storefronts, marketplaces, and portals: the software your customers log into. Built to work on a phone first, to handle real volume, and to integrate cleanly with whatever you already use.
                </p>
              </div>
              <div className="p-10 md:py-12 md:px-10 border-b md:border-b-0 hairline border-r hairline">
                <div className="text-[12px] font-medium text-faint uppercase tracking-wider">03 / SAAS PRODUCTS</div>
                <h3 className="font-serif text-[24px] font-medium text-ink mt-3">Multi-tenant SaaS products.</h3>
                <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                  The software you sell, not just the software you use. Tenants, plans, billing, RBAC, integrations, admin. We've shipped two of these; see WeShip and Airhouse.
                </p>
              </div>
              <div className="p-10 md:py-12 md:px-10 border-r hairline">
                <div className="text-[12px] font-medium text-faint uppercase tracking-wider">04 / INTEGRATIONS</div>
                <h3 className="font-serif text-[24px] font-medium text-ink mt-3">Integrations and automation.</h3>
                <p className="font-sans text-[16px] text-muted mt-3 leading-relaxed">
                  The plumbing between the tools you already pay for: your store, your payments, your couriers, your accounting, your messaging. Fewer humans copy-pasting between tabs.
                </p>
              </div>
            </div>
          </Container>
        </section>

        {/* Section 5 - How we work */}
        <section className="py-20 md:py-24 border-t hairline">
          <Container>
            <h2 className="font-serif text-[32px] md:text-[40px] font-medium text-ink">How we work</h2>
            <p className="font-sans text-[17px] text-muted mt-4">
              We don't pitch. We listen, scope, and build.
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-12 md:gap-0 mt-16">
              <div className="md:pr-8">
                <div className="font-serif text-[64px] font-medium text-ink">1</div>
                <h3 className="font-serif text-[22px] font-medium text-ink mt-4">Listen.</h3>
                <p className="font-sans text-[15px] text-muted mt-3 leading-relaxed">
                  A free working session, up to an hour. You explain the problem in plain language. We ask sharp questions and sketch what software around it might look like. No slides, no upsell. You'll leave with a clearer picture either way.
                </p>
              </div>
              <div className="md:pr-8">
                <div className="font-serif text-[64px] font-medium text-ink">2</div>
                <h3 className="font-serif text-[22px] font-medium text-ink mt-4">Scope.</h3>
                <p className="font-sans text-[15px] text-muted mt-3 leading-relaxed">
                  Within a week, you get a written proposal: what we'd build, what it costs, how long it takes, what we need from you. Fixed scope, fixed price.
                </p>
              </div>
              <div className="md:pr-8">
                <div className="font-serif text-[64px] font-medium text-ink">3</div>
                <h3 className="font-serif text-[22px] font-medium text-ink mt-4">Build and ship.</h3>
                <p className="font-sans text-[15px] text-muted mt-3 leading-relaxed">
                  We build in weeks, not quarters. Weekly check-ins, working software at every checkpoint. When it's done, the code is yours.
                </p>
              </div>
            </div>
          </Container>
        </section>

        {/* Section 6 - Why Operandi */}
        <section className="py-20 md:py-24 border-t hairline bg-paper">
          <Container>
            <div className="flex flex-col md:flex-row gap-12 md:gap-0">
              <div className="md:w-[40%]">
                <h2 className="font-serif text-[32px] md:text-[40px] font-medium text-ink">Why Operandi</h2>
              </div>
              <div className="md:w-[55%] md:ml-auto">
                <div className="font-sans text-[18px] text-ink leading-[1.65] space-y-6">
                  <p>
                    <em>Modus operandi:</em> the way someone operates. The name is the point. Every business we work with has a way of operating that nothing on the shelf can match. We design software around that, not the other way around.
                  </p>
                  <p>
                    We build fast, because we use modern tools and we don't waste your time. We build well, because we've already shipped production systems across logistics, finance, property, retail, and CRM. The flagship builds on this page are a sample of that work. We know what breaks because we've broken it and fixed it ourselves. That's a different kind of credibility than a case-study deck.
                  </p>
                </div>
              </div>
            </div>
          </Container>
        </section>

        {/* Section 7 - FAQ */}
        <section className="py-20 md:py-24 border-t hairline">
          <Container>
            <h2 className="font-serif text-[32px] md:text-[40px] font-medium text-ink mb-12">Questions</h2>
            
            <div className="max-w-[800px]">
              {faqs.map((faq, index) => {
                const isOpen = openFaq === index;
                return (
                  <div key={index} className={`border-t hairline ${index === faqs.length - 1 ? 'border-b hairline' : ''}`}>
                    <button 
                      onClick={() => setOpenFaq(isOpen ? null : index)}
                      className="w-full py-6 flex items-center justify-between text-left group focus:outline-none"
                    >
                      <h3 className="font-serif text-[22px] font-medium text-ink group-hover:text-accent transition-colors pr-8">
                        {faq.q}
                      </h3>
                      <div className="text-ink flex-shrink-0 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(45deg)' : 'rotate(0)' }}>
                        <Plus size={24} strokeWidth={1.5} />
                      </div>
                    </button>
                    <div 
                      className={`overflow-hidden transition-all duration-300 ease-in-out ${isOpen ? 'max-h-[500px] pb-8 opacity-100' : 'max-h-0 opacity-0'}`}
                    >
                      <p className="font-sans text-[16px] text-muted leading-relaxed max-w-[700px]">
                        {faq.a}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </Container>
        </section>

        {/* Section 8 - Final CTA */}
        <section className="py-20 md:py-24 border-t hairline text-center">
          <Container>
            <div className="max-w-[600px] mx-auto flex flex-col items-center">
              <h2 className="font-serif text-[36px] md:text-[48px] font-semibold text-ink leading-tight">
                Have a problem worth solving?
              </h2>
              <p className="font-sans text-[18px] text-muted mt-4 max-w-[480px] leading-relaxed">
                Tell us what your team is struggling with. We'll tell you, honestly, whether software is the answer, and if so, what it looks like.
              </p>
              <div className="mt-8">
                <BookCallButton
                  className="inline-block bg-ink text-white px-8 py-4 text-[14px] font-medium uppercase tracking-wider hover:bg-accent transition-colors rounded-sm cursor-pointer"
                >
                  Book a 30-minute call
                </BookCallButton>
              </div>
            </div>
          </Container>
        </section>
      </main>

      <Footer />
    </div>
  );
}
