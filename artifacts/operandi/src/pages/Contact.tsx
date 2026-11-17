import { useEffect, useState } from "react";
import { Link } from "wouter";
import { post, errorMessage, fieldErrors } from "@/lib/api";
import { attribution } from "@/lib/analytics";
import { usePublicSettings } from "@/lib/settings";
import { Alert, Btn, Checkbox, SelectField, TextArea, TextField } from "@/components/ui-kit";
import Cal, { getCalApi } from "@calcom/embed-react";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { Container } from "@/components/Container";
import { CAL_LINK, CAL_NAMESPACE } from "@/lib/cal";

function ContactForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", company: "", topic: "new_project", message: "", consentProcessing: false, consentMarketing: false, website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof form) => (e: { target: { value: string; checked?: boolean; type?: string } }) => setForm({ ...form, [k]: e.target.type === "checkbox" ? Boolean(e.target.checked) : e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await post<{ reference: string }>("/contact", { ...form, phone: form.phone || undefined, company: form.company || undefined, consentProcessing: form.consentProcessing || undefined, website: form.website || undefined, attribution: attribution() });
      setDone(r.reference);
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  if (done) {
    return (
      <Alert tone="success" title="Thanks — message received">
        Your reference is {done}. We reply within two working days. Want a faster answer? <Link href="/configure" className="underline">Configure your project</Link> for an instant indicative assessment.
      </Alert>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4" noValidate aria-label="Contact form">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Name" required autoComplete="name" value={form.name} onChange={set("name")} error={errors.name} />
        <TextField label="Email" type="email" required autoComplete="email" value={form.email} onChange={set("email")} error={errors.email} />
        <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={form.phone} onChange={set("phone")} error={errors.phone} />
        <TextField label="Company (optional)" autoComplete="organization" value={form.company} onChange={set("company")} />
      </div>
      <SelectField label="What's it about?" value={form.topic} onChange={set("topic")} options={[{ value: "new_project", label: "A new project" }, { value: "package_question", label: "A question about a package" }, { value: "existing_client", label: "I'm an existing client" }, { value: "partnership", label: "Partnership" }, { value: "other", label: "Something else" }]} />
      <TextArea label="Message" required rows={5} value={form.message} onChange={set("message")} error={errors.message} />
      <input type="text" name="website" value={form.website} onChange={set("website")} className="hidden" tabIndex={-1} autoComplete="off" aria-hidden />
      <Checkbox checked={form.consentProcessing} onChange={set("consentProcessing")} label={<>I consent to Operandis using these details to respond to me (<Link href="/privacy" className="underline">Privacy Policy</Link>).</>} />
      <Checkbox checked={form.consentMarketing} onChange={set("consentMarketing")} label="Send me occasional updates (optional)." />
      {error && <Alert tone="danger">{error}</Alert>}
      <Btn type="submit" loading={busy} disabled={!form.consentProcessing}>Send message</Btn>
    </form>
  );
}

export default function Contact() {
  const { business } = usePublicSettings();
  useEffect(() => {
    document.title = "Contact — Operandis";
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
      <main id="main" className="flex-grow">
        <section className="pt-32 pb-12 md:pb-16 border-b hairline">
          <Container>
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-4">
              OPERANDIS / CONTACT
            </div>
            <h1 className="font-serif text-[40px] md:text-[56px] font-semibold text-ink leading-tight tracking-tight">
              Talk to us.
            </h1>
            <p className="font-sans text-[18px] text-muted max-w-[640px] mt-4 leading-relaxed">
              Book a free working session, send us a message, or <Link href="/configure" className="underline text-ink">configure your project</Link> for an instant indicative assessment.
            </p>
          </Container>
        </section>

        <section className="py-24">
          <Container>
            <div className="max-w-[720px] mx-auto">
              <h2 className="font-serif text-[28px] text-ink mb-6">Send a message</h2>
              <ContactForm />
              <h2 className="font-serif text-[28px] text-ink mt-20 mb-2">Or book a call</h2>
              <p className="text-muted mb-6">A free working session, up to an hour. You explain the problem in plain language. We ask sharp questions and sketch what software around it might look like.</p>
              <div className="border hairline rounded-sm overflow-hidden bg-white">
                <Cal
                  namespace={CAL_NAMESPACE}
                  calLink={business.calLink || CAL_LINK}
                  style={{ width: "100%", height: "680px", overflow: "scroll" }}
                  config={{ layout: "month_view", theme: "light" }}
                />
              </div>
              <p className="text-[13px] text-faint mt-3 text-center">
                Prefer email? Reach us at{" "}
                <a href={`mailto:${business.email}`} className="text-ink underline hover:text-accent">
                  {business.email}
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
