import { Container } from "./Container";
import { Link } from "wouter";
import { CookiePreferencesLink } from "./ConsentBanner";
import { usePublicSettings } from "@/lib/settings";

export function Footer() {
  const { business } = usePublicSettings();
  return (
    <footer className="border-t hairline bg-paper pt-16 pb-8">
      <Container>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 md:gap-12 mb-16">
          <div className="col-span-2 md:col-span-1">
            <div className="font-serif font-medium text-[22px] text-ink tracking-tight mb-4">{business.tradingName}</div>
            <p className="text-[14px] text-muted max-w-[280px]">We build the software your business stands on.</p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">Studio</div>
            <Link href="/work" className="text-[14px] text-ink hover:text-muted">Work</Link>
            <Link href="/services" className="text-[14px] text-ink hover:text-muted">Services</Link>
            <Link href="/process" className="text-[14px] text-ink hover:text-muted">Process</Link>
            <Link href="/about" className="text-[14px] text-ink hover:text-muted">About</Link>
            <Link href="/contact" className="text-[14px] text-ink hover:text-muted">Contact</Link>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">Start</div>
            <Link href="/packages" className="text-[14px] text-ink hover:text-muted">Packages</Link>
            <Link href="/configure" className="text-[14px] text-ink hover:text-muted">Configure a project</Link>
            <Link href="/packages/discovery-sprint" className="text-[14px] text-ink hover:text-muted">Discovery sprint</Link>
            <Link href="/portal" className="text-[14px] text-ink hover:text-muted">Client portal</Link>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">Legal</div>
            <Link href="/privacy" className="text-[14px] text-ink hover:text-muted">Privacy Policy</Link>
            <Link href="/terms" className="text-[14px] text-ink hover:text-muted">Terms of Service</Link>
            <Link href="/cookies" className="text-[14px] text-ink hover:text-muted">Cookie Notice</Link>
            <CookiePreferencesLink className="text-[14px] text-ink hover:text-muted text-left" />
          </div>

          <div className="flex flex-col gap-4 col-span-2 md:col-span-1">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">Contact</div>
            <a href={`mailto:${business.email}`} className="text-[14px] text-ink hover:text-muted [overflow-wrap:anywhere]">{business.email}</a>
            <a href={`mailto:${business.legalEmail}`} className="text-[14px] text-ink hover:text-muted [overflow-wrap:anywhere]">{business.legalEmail}</a>
            <address className="not-italic text-[14px] text-muted leading-relaxed">
              {business.address.map((line) => (
                <span key={line} className="block">{line}</span>
              ))}
            </address>
          </div>
        </div>

        <div className="border-t hairline pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p className="text-[12px] text-faint">
            &copy; {new Date().getFullYear()} {business.tradingName}. {business.tradingName} is a trading name. All rights reserved.
          </p>
          <p className="text-[12px] text-faint">Built in Pretoria, South Africa.</p>
        </div>
      </Container>
    </footer>
  );
}
