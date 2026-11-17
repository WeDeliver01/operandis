import { useEffect } from "react";
import Cal, { getCalApi } from "@calcom/embed-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";
import { CAL_LINK, CAL_NAMESPACE } from "@/lib/cal";

export default function Contact() {
  useEffect(() => {
    document.title = "Contact — Operandi";
  }, []);

  useEffect(() => {
    (async () => {
      const cal = await getCalApi({ namespace: CAL_NAMESPACE });
      cal("ui", {
        hideEventTypeDetails: false,
        layout: "month_view",
        theme: "light",
      });
    })();
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-paper text-ink">
      <Nav />
      <main className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16 border-b hairline">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDI / CONTACT
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              Book a call.
            </h1>
            <p className="font-sans text-[18px] text-muted max-w-[640px] mt-4 leading-relaxed">
              A free working session, up to an hour. You explain the problem in plain language. We ask sharp questions and sketch what software around it might look like.
            </p>
          </Container>
        </section>

        <section className="py-24">
          <Container>
            <div className="max-w-[720px] mx-auto">
              <div className="border hairline rounded-sm overflow-hidden bg-white">
                <Cal
                  namespace={CAL_NAMESPACE}
                  calLink={CAL_LINK}
                  style={{ width: "100%", height: "680px", overflow: "scroll" }}
                  config={{ layout: "month_view", theme: "light" }}
                />
              </div>
              <p className="text-[13px] text-faint mt-3 text-center">
                Prefer email? Reach us at{" "}
                <a href="mailto:hello@operandi.studio" className="text-ink underline hover:text-accent">
                  hello@operandi.studio
                </a>
                .
              </p>

              <div className="mt-16 pt-16 border-t hairline grid grid-cols-1 md:grid-cols-3 gap-12">
                <div>
                  <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">
                    Email
                  </div>
                  <a href="mailto:hello@operandi.studio" className="block text-[15px] text-ink hover:text-accent transition-colors">
                    hello@operandi.studio
                  </a>
                  <a href="mailto:legal@operandi.studio" className="block text-[15px] text-ink hover:text-accent transition-colors mt-1">
                    legal@operandi.studio
                  </a>
                </div>
                <div>
                  <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">
                    Studio
                  </div>
                  <address className="not-italic text-[15px] text-muted leading-relaxed">
                    10 Camellia Avenue<br />
                    Lynnwood, Pretoria, 0081<br />
                    South Africa
                  </address>
                </div>
                <div>
                  <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">
                    Hours
                  </div>
                  <p className="text-[15px] text-muted leading-relaxed">
                    Monday &ndash; Friday<br />
                    08h00 &ndash; 17h00 SAST<br />
                    By appointment.
                  </p>
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
