import { Container } from "./Container";
import { Link } from "wouter";
import { CookiePreferencesLink } from "./ConsentBanner";

export function Footer() {
  return (
    <footer className="border-t hairline bg-paper pt-16 pb-8">
      <Container>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
          <div className="md:col-span-1">
            <div className="font-serif font-medium text-[22px] text-ink tracking-tight mb-4">
              Operandi
            </div>
            <p className="text-[14px] text-muted max-w-[280px]">
              We build the software your business stands on.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">
              Studio
            </div>
            <Link href="/products" className="text-[14px] text-ink hover:text-muted">Products</Link>
            <Link href="/services" className="text-[14px] text-ink hover:text-muted">Services</Link>
            <Link href="/process" className="text-[14px] text-ink hover:text-muted">Process</Link>
            <Link href="/about" className="text-[14px] text-ink hover:text-muted">About</Link>
            <Link href="/contact" className="text-[14px] text-ink hover:text-muted">Contact</Link>
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">
              Legal
            </div>
            <Link href="/privacy" className="text-[14px] text-ink hover:text-muted">Privacy Policy</Link>
            <Link href="/terms" className="text-[14px] text-ink hover:text-muted">Terms of Service</Link>
            <Link href="/cookies" className="text-[14px] text-ink hover:text-muted">Cookie Notice</Link>
            <CookiePreferencesLink className="text-[14px] text-ink hover:text-muted text-left" />
          </div>

          <div className="flex flex-col gap-4">
            <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-1">
              Contact
            </div>
            <a href="mailto:hello@operandi.studio" className="text-[14px] text-ink hover:text-muted">hello@operandi.studio</a>
            <a href="mailto:legal@operandi.studio" className="text-[14px] text-ink hover:text-muted">legal@operandi.studio</a>
            <address className="not-italic text-[14px] text-muted leading-relaxed">
              10 Camellia Avenue<br />
              Lynnwood, Pretoria, 0081<br />
              South Africa
            </address>
          </div>
        </div>

        <div className="border-t hairline pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-2">
          <p className="text-[12px] text-faint">
            &copy; {new Date().getFullYear()} Operandi. Operandi is a trading name. All rights reserved.
          </p>
          <p className="text-[12px] text-faint">
            Built in Pretoria, South Africa.
          </p>
        </div>
      </Container>
    </footer>
  );
}
