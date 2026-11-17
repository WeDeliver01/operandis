import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { BookCallButton } from "./BookCallButton";
import { Container } from "./Container";
import { Menu, X } from "lucide-react";

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [location] = useLocation();

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 8);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location]);

  const links = [
    { label: "Products", href: "/products" },
    { label: "Services", href: "/services" },
    { label: "Process", href: "/process" },
    { label: "About", href: "/about" },
  ];

  return (
    <>
      <header
        className={`fixed top-0 left-0 right-0 z-50 bg-paper/95 backdrop-blur-sm transition-colors duration-300 ${
          scrolled ? "border-b hairline" : ""
        }`}
      >
        <Container>
          <div className="flex items-center justify-between h-20">
            <Link href="/" className="font-serif font-medium text-[22px] text-ink tracking-tight">
              Operandi
            </Link>

            <nav className="hidden md:flex items-center gap-8">
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="text-[14px] font-medium text-ink hover:text-muted transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>

            <div className="hidden md:block">
              <BookCallButton variant="secondary" />
            </div>

            <button
              className="md:hidden p-2 -mr-2 text-ink"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={24} />
            </button>
          </div>
        </Container>
      </header>

      {mobileMenuOpen && (
        <div className="fixed inset-0 z-[60] bg-paper flex flex-col">
          <div className="flex items-center justify-between h-20 px-6 border-b hairline">
            <Link href="/" className="font-serif font-medium text-[22px] text-ink tracking-tight">
              Operandi
            </Link>
            <button
              className="p-2 -mr-2 text-ink"
              onClick={() => setMobileMenuOpen(false)}
              aria-label="Close menu"
            >
              <X size={24} />
            </button>
          </div>
          <nav className="flex flex-col p-6 gap-6 flex-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[24px] font-serif font-medium text-ink hover:text-muted"
              >
                {link.label}
              </Link>
            ))}
            <div className="mt-auto pb-8">
              <BookCallButton variant="primary" />
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
