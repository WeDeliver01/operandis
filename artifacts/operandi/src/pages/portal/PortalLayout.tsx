import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Bell, FileText, FolderKanban, Home, LifeBuoy, LogOut, Receipt, ScrollText, ShoppingBag, User, Wrench } from "lucide-react";
import { Container } from "@/components/Container";
import { Nav } from "@/components/Nav";
import { useAuth } from "@/lib/auth";
import { get, post } from "@/lib/api";
import { Alert, Btn } from "@/components/ui-kit";
import { useState } from "react";

const ITEMS = [
  { href: "/portal", label: "Overview", icon: Home, exact: true },
  { href: "/portal/projects", label: "Projects", icon: FolderKanban },
  { href: "/portal/proposals", label: "Proposals", icon: ScrollText },
  { href: "/portal/invoices", label: "Invoices & payments", icon: Receipt },
  { href: "/portal/orders", label: "Orders", icon: ShoppingBag },
  { href: "/portal/enquiries", label: "Enquiries & estimates", icon: FileText },
  { href: "/portal/requests", label: "Support & changes", icon: Wrench },
  { href: "/portal/notifications", label: "Notifications", icon: Bell },
  { href: "/portal/profile", label: "Profile & security", icon: User },
];

export function PortalLayout({ title, actions, children, back }: { title: ReactNode; actions?: ReactNode; children: ReactNode; back?: { href: string; label: string } }) {
  const [location, navigate] = useLocation();
  const { me, logout, isStaff } = useAuth();
  const unread = useQuery({ queryKey: ["unread"], queryFn: () => get<{ count: number }>("/portal/unread-count"), refetchInterval: 60_000 });
  const [resent, setResent] = useState(false);
  return (
    <div className="min-h-screen flex flex-col bg-paper">
      <Nav />
      <main id="main" className="flex-grow pt-24 pb-20">
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-8 lg:gap-12">
            <aside aria-label="Portal navigation">
              <div className="text-[12px] uppercase tracking-wider text-faint mb-1">Client portal</div>
              <div className="text-[14px] text-ink font-medium truncate">{me?.organizations[0]?.name ?? me?.name}</div>
              <nav className="mt-5 flex lg:flex-col gap-1 overflow-x-auto pb-2 lg:pb-0 -mx-1 px-1">
                {ITEMS.map(({ href, label, icon: Icon, exact }) => {
                  const active = exact ? location === href : location === href || location.startsWith(`${href}/`);
                  return (
                    <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-2.5 px-3 py-2 rounded-sm text-[14px] whitespace-nowrap ${active ? "bg-ink text-paper" : "text-ink hover:bg-ink/5"}`}>
                      <Icon size={15} aria-hidden />
                      {label}
                      {href === "/portal/notifications" && (unread.data?.count ?? 0) > 0 && <span className={`ml-auto text-[11px] rounded-full px-1.5 ${active ? "bg-paper text-ink" : "bg-ink text-paper"}`}>{unread.data!.count}</span>}
                    </Link>
                  );
                })}
                {isStaff && (
                  <Link href="/admin" className="flex items-center gap-2.5 px-3 py-2 rounded-sm text-[14px] text-ink hover:bg-ink/5 whitespace-nowrap">
                    <LifeBuoy size={15} /> Staff console
                  </Link>
                )}
                <button type="button" onClick={async () => { await logout(); navigate("/"); }} className="flex items-center gap-2.5 px-3 py-2 rounded-sm text-[14px] text-muted hover:bg-ink/5 whitespace-nowrap text-left">
                  <LogOut size={15} /> Sign out
                </button>
              </nav>
            </aside>
            <div className="min-w-0">
              {me && !me.emailVerified && !isStaff && (
                <Alert tone="warning" className="mb-6" title="Confirm your email to see your projects and invoices">
                  We sent a confirmation link to {me.email}.{" "}
                  {resent ? "Sent again — check your inbox." : <Btn variant="link" onClick={async () => { await post("/auth/resend-verification"); setResent(true); }}>Resend link</Btn>}
                </Alert>
              )}
              {back && (
                <Link href={back.href} className="text-[13px] text-muted hover:text-ink">
                  ← {back.label}
                </Link>
              )}
              <div className="flex flex-wrap items-end justify-between gap-4 mb-8 mt-1">
                <h1 className="font-serif text-[30px] md:text-[38px] font-semibold text-ink leading-tight">{title}</h1>
                {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
              </div>
              {children}
            </div>
          </div>
        </Container>
      </main>
    </div>
  );
}
