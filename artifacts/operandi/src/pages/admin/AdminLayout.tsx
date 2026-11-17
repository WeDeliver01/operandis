import { useState, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useInfiniteQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Boxes,
  Calculator,
  ClipboardList,
  CreditCard,
  FileStack,
  FolderKanban,
  Inbox,
  LayoutDashboard,
  LogOut,
  Mail,
  Menu,
  Receipt,
  ScrollText,
  Settings,
  ShieldCheck,
  ShoppingBag,
  Users,
  Wrench,
  X,
  Image,
} from "lucide-react";
import type { Permission } from "@workspace/domain";
import { useAuth } from "@/lib/auth";
import { get } from "@/lib/api";
import { useBrand } from "@/lib/settings";
import { Btn } from "@/components/ui-kit";
import { ErrorState, LoadingState } from "@/components/ui-kit/states";

const NAV: { group: string; items: { href: string; label: string; icon: typeof Inbox; perm: Permission[] }[] }[] = [
  { group: "Overview", items: [{ href: "/admin", label: "Dashboard", icon: LayoutDashboard, perm: ["dashboard.read"] }] },
  {
    group: "Sales",
    items: [
      { href: "/admin/leads", label: "Leads", icon: Inbox, perm: ["leads.read_all", "leads.read_assigned"] },
      { href: "/admin/submissions", label: "Configurator briefs", icon: ClipboardList, perm: ["submissions.read"] },
      { href: "/admin/proposals", label: "Proposals", icon: ScrollText, perm: ["proposals.manage"] },
    ],
  },
  {
    group: "Delivery",
    items: [
      { href: "/admin/projects", label: "Projects", icon: FolderKanban, perm: ["projects.read_all", "projects.read_assigned"] },
      { href: "/admin/requests", label: "Requests", icon: Wrench, perm: ["requests.manage"] },
    ],
  },
  {
    group: "Finance",
    items: [
      { href: "/admin/orders", label: "Orders", icon: ShoppingBag, perm: ["orders.read"] },
      { href: "/admin/invoices", label: "Invoices", icon: Receipt, perm: ["invoices.read"] },
      { href: "/admin/payments", label: "Payments & refunds", icon: CreditCard, perm: ["payments.read"] },
    ],
  },
  {
    group: "Catalogue & content",
    items: [
      { href: "/admin/packages", label: "Packages", icon: Boxes, perm: ["packages.manage"] },
      { href: "/admin/pricing", label: "Pricing rules", icon: Calculator, perm: ["pricing.manage"] },
      { href: "/admin/portfolio", label: "Portfolio", icon: Image, perm: ["content.manage"] },
      { href: "/admin/content", label: "Services & FAQs", icon: FileStack, perm: ["content.manage"] },
    ],
  },
  {
    group: "System",
    items: [
      { href: "/admin/reports", label: "Reports", icon: BarChart3, perm: ["dashboard.read"] },
      { href: "/admin/users", label: "Users & roles", icon: Users, perm: ["users.read"] },
      { href: "/admin/audit", label: "Audit log", icon: ShieldCheck, perm: ["audit.read"] },
      { href: "/admin/emails", label: "Email log", icon: Mail, perm: ["settings.manage"] },
      { href: "/admin/settings", label: "Settings", icon: Settings, perm: ["settings.manage"] },
    ],
  },
];

export function AdminLayout({ title, actions, children, back, description }: { title: ReactNode; actions?: ReactNode; children: ReactNode; back?: { href: string; label: string }; description?: ReactNode }) {
  const [location, navigate] = useLocation();
  const { me, can, logout } = useAuth();
  const brand = useBrand();
  const [open, setOpen] = useState(false);
  const nav = (
    <nav aria-label="Console" className="space-y-6">
      {NAV.map((g) => {
        const items = g.items.filter((i) => i.perm.some((p) => can(p)));
        if (!items.length) return null;
        return (
          <div key={g.group}>
            <div className="text-[11px] uppercase tracking-wider text-paper/40 px-3 mb-1.5">{g.group}</div>
            {items.map(({ href, label, icon: Icon }) => {
              const active = href === "/admin" ? location === "/admin" : location === href || location.startsWith(`${href}/`);
              return (
                <Link key={href} href={href} onClick={() => setOpen(false)} aria-current={active ? "page" : undefined} className={`flex items-center gap-2.5 px-3 py-1.5 rounded-sm text-[14px] ${active ? "bg-paper text-ink" : "text-paper/80 hover:bg-paper/10 hover:text-paper"}`}>
                  <Icon size={15} aria-hidden /> {label}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
  return (
    <div className="min-h-screen bg-paper lg:grid lg:grid-cols-[232px_1fr]">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-ink focus:text-paper focus:px-4 focus:py-2">Skip to content</a>
      <aside className="hidden lg:flex flex-col bg-ink text-paper sticky top-0 h-screen overflow-y-auto px-3 py-6">
        <Link href="/" className="font-serif text-[20px] px-3 mb-1">{brand}</Link>
        <div className="text-[11px] uppercase tracking-wider text-paper/40 px-3 mb-6">Operations console</div>
        {nav}
        <div className="mt-auto pt-6 px-3 text-[12px] text-paper/60">
          <div className="truncate">{me?.name}</div>
          <div className="truncate">{me?.role}</div>
          <button type="button" onClick={async () => { await logout(); navigate("/login"); }} className="mt-2 inline-flex items-center gap-1.5 hover:text-paper"><LogOut size={13} /> Sign out</button>
        </div>
      </aside>
      <div className="min-w-0">
        <header className="lg:hidden flex items-center justify-between h-14 px-4 bg-ink text-paper">
          <span className="font-serif text-[18px]">{brand} console</span>
          <button onClick={() => setOpen(true)} aria-label="Open console menu"><Menu size={22} /></button>
        </header>
        {open && (
          <div className="fixed inset-0 z-[70] bg-ink text-paper overflow-y-auto p-4 lg:hidden" role="dialog" aria-modal="true">
            <div className="flex justify-end mb-4"><button onClick={() => setOpen(false)} aria-label="Close menu"><X size={22} /></button></div>
            {nav}
          </div>
        )}
        <main id="main" className="px-4 md:px-8 py-8 max-w-[1280px]">
          {back && <Link href={back.href} className="text-[13px] text-muted hover:text-ink">← {back.label}</Link>}
          <div className="flex flex-wrap items-end justify-between gap-4 mb-6 mt-1">
            <div className="min-w-0">
              <h1 className="font-serif text-[28px] md:text-[34px] font-semibold text-ink leading-tight">{title}</h1>
              {description && <p className="text-[14px] text-muted mt-1">{description}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
          </div>
          {children}
        </main>
      </div>
    </div>
  );
}

/** Cursor-paginated list with "load more". */
export function useCursorList<T>(key: unknown[], path: string) {
  return useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) => get<{ items: T[]; nextCursor: string | null }>(`${path}${path.includes("?") ? "&" : "?"}${pageParam ? `cursor=${encodeURIComponent(pageParam)}` : ""}`),
    initialPageParam: "" as string,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

export function CursorList<T>({ q, children, empty }: { q: ReturnType<typeof useCursorList<T>>; children: (items: T[]) => ReactNode; empty?: ReactNode }) {
  if (q.isLoading) return <LoadingState />;
  if (q.error) return <ErrorState error={q.error} retry={() => void q.refetch()} />;
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];
  if (!items.length && empty) return <>{empty}</>;
  return (
    <>
      {children(items)}
      {q.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Btn variant="secondary" size="sm" loading={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Btn>
        </div>
      )}
    </>
  );
}

/** Responsive table: horizontal scroll on narrow screens with a minimum width. */
export function Table({ head, children, minWidth = 720 }: { head: ReactNode[]; children: ReactNode; minWidth?: number }) {
  return (
    <div className="bg-white border hairline rounded-sm overflow-x-auto">
      <table className="w-full text-[14px]" style={{ minWidth }}>
        <thead>
          <tr className="text-left text-[11px] uppercase tracking-wider text-faint border-b hairline">
            {head.map((h, i) => (
              <th key={i} scope="col" className="px-4 py-3 font-medium whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y hairline">{children}</tbody>
      </table>
    </div>
  );
}

export const Td = ({ children, className = "" }: { children?: ReactNode; className?: string }) => <td className={`px-4 py-3 align-top ${className}`}>{children}</td>;

/** Edit a string[] as one item per line. */
export function LinesField({ label, value, onChange, hint, rows = 4 }: { label: string; value: string[]; onChange: (v: string[]) => void; hint?: string; rows?: number }) {
  const [text, setText] = useState(value.join("\n"));
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[13px] font-medium text-ink">{label}</span>
      <textarea
        rows={rows}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(e.target.value.split("\n").map((s) => s.trim()).filter(Boolean));
        }}
        className="w-full bg-white border border-rule rounded-sm px-3 py-2 text-[14px] focus:outline-none focus:border-ink"
      />
      <span className="text-[12px] text-muted">{hint ?? "One item per line."}</span>
    </label>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs }: { value: T; onChange: (v: T) => void; tabs: { key: NoInfer<T>; label: string }[] }) {
  return (
    <div role="tablist" className="flex gap-1 border-b hairline mb-6 overflow-x-auto">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)} className={`px-4 py-2.5 text-[14px] whitespace-nowrap border-b-2 -mb-px ${value === t.key ? "border-ink text-ink font-medium" : "border-transparent text-muted hover:text-ink"}`}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function FilterBar({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap items-end gap-3 mb-5">{children}</div>;
}
