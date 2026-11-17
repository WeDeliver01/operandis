import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Menu, X, User } from "lucide-react";
import { Container } from "./Container";
import { useAuth } from "@/lib/auth";
import { useBrand } from "@/lib/settings";

const LINKS = [
  { label: "Work", href: "/work", match: ["/work", "/products"] },
  { label: "Services", href: "/services" },
  { label: "Packages", href: "/packages" },
  { label: "Process", href: "/process" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();
  const { me } = useAuth();
  const brand = useBrand();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const isActive = (l: (typeof LINKS)[number]) => (l.match ?? [l.href]).some((m) => location === m || location.startsWith(`${m}/`));
  const accountHref = me ? (me.role === "client" ? "/portal" : "/admin") : "/login";
  const accountLabel = me ? (me.role === "client" ? "Client portal" : "Console") : "Sign in";

  return (
    <>
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-ink focus:text-paper focus:px-4 focus:py-2">
        Skip to content
      </a>
      <header className={`fixed top-0 left-0 right-0 z-50 bg-paper/95 backdrop-blur-sm transition-colors duration-300 ${scrolled ? "border-b hairline" : ""}`}>
        <Container>
          <div className="flex items-center justify-between h-20 gap-6">
            <Link href="/" className="font-serif font-medium text-[22px] text-ink tracking-tight shrink-0">
              {brand}
            </Link>

            <nav aria-label="Main" className="hidden lg:flex items-center gap-7">
              {LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  aria-current={isActive(link) ? "page" : undefined}
                  className={`text-[14px] font-medium transition-colors ${isActive(link) ? "text-ink underline underline-offset-[6px] decoration-1" : "text-ink hover:text-muted"}`}
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="hidden lg:flex items-center gap-4 shrink-0">
              <Link href={accountHref} className="inline-flex items-center gap-1.5 text-[14px] font-medium text-ink hover:text-muted">
                <User size={15} aria-hidden />
                {accountLabel}
              </Link>
              <Link href="/configure" className="inline-block text-[13px] font-medium uppercase tracking-wider px-5 py-3 rounded-sm bg-ink text-paper hover:bg-accent transition-colors">
                Configure a project
              </Link>
            </div>

            <button className="lg:hidden p-2 -mr-2 text-ink" onClick={() => setMobileMenuOpen(true)} aria-label="Open menu" aria-expanded={mobileMenuOpen}>
              <Menu size={24} />
            </button>
          </div>
        </Container>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-paper flex flex-col" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="flex items-center justify-between h-20 px-6 border-b hairline">
            <Link href="/" className="font-serif font-medium text-[22px] text-ink tracking-tight">
              {brand}
            </Link>
            <button className="p-2 -mr-2 text-ink" onClick={() => setMobileMenuOpen(false)} aria-label="Close menu">
              <X size={24} />
            </button>
          </div>
          <nav aria-label="Mobile" className="flex flex-col p-6 gap-5 flex-1 overflow-y-auto">
            {LINKS.map((link) => (
              <Link key={link.href} href={link.href} className="text-[24px] font-serif font-medium text-ink hover:text-muted">
                {link.label}
              </Link>
            ))}
            <Link href={accountHref} className="text-[18px] text-ink mt-2 inline-flex items-center gap-2">
              <User size={18} /> {accountLabel}
            </Link>
            <div className="mt-auto pb-8">
              <Link href="/configure" className="block text-center text-[14px] font-medium uppercase tracking-wider px-6 py-4 rounded-sm bg-ink text-paper">
                Configure a project
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
