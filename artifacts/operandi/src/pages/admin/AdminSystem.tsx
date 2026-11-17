import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { ROLES, canAssignRole, type Role } from "@workspace/domain";
import { AdminLayout, CursorList, FilterBar, LinesField, Table, Tabs, Td, useCursorList } from "./AdminLayout";
import { get, post, put, patch, del, errorMessage, fieldErrors } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, humanize, percent } from "@/lib/format";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, Checkbox, SelectField, StatusBadge, TextArea, TextField } from "@/components/ui-kit";
import { Modal } from "@/components/ui-kit/overlay";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ================================================================ portfolio CMS
export function AdminPortfolio() {
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["admin", "portfolio"], queryFn: () => get<Any[]>("/admin/portfolio") });
  return (
    <AdminLayout title="Portfolio" description="Case studies shown on /work. The six original case studies keep their long-form bodies unless you add Markdown here." actions={<Btn size="sm" onClick={() => navigate("/admin/portfolio/new")}>New project</Btn>}>
      <QueryView query={q} empty={<EmptyState title="No projects" />}>
        {(list) => (
          <Table head={["Project", "Status label", "Publication", "Featured", "Order", "Updated"]}>
            {list.map((p) => (<tr key={p.id} className="hover:bg-ink/[0.02]"><Td><Link href={`/admin/portfolio/${p.id}`} className="font-medium hover:underline">{p.title}</Link><span className="block text-[12px] text-muted">/{p.slug}</span></Td><Td>{humanize(p.statusLabel)}</Td><Td><StatusBadge status={p.publicationStatus} /></Td><Td>{p.featured ? "Yes" : "—"}</Td><Td>{p.displayOrder}</Td><Td>{date(p.updatedAt)}</Td></tr>))}
          </Table>
        )}
      </QueryView>
    </AdminLayout>
  );
}

const EMPTY_PORTFOLIO = { slug: "", title: "", shortDescription: "", longDescription: "", challenge: "", approach: "", solution: "", features: [], outcomes: [], industry: "", projectType: "", stack: "", technologyTags: [], serviceCategorySlugs: [], thumbnailUrl: null, heroUrl: null, logoUrl: null, gallery: [], externalUrl: null, accessNote: null, featured: false, statusLabel: "live", publicationStatus: "draft", displayOrder: 0, testimonial: null, bodyMarkdown: "", seoTitle: null, seoDescription: null };

export function AdminPortfolioEdit({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "portfolio", params.id], queryFn: () => get<Any>(`/admin/portfolio/${params.id}`), enabled: !isNew });
  const services = useQuery({ queryKey: ["services"], queryFn: () => get<Any[]>("/services") });
  const [f, setF] = useState<Any>(isNew ? EMPTY_PORTFOLIO : null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (q.data) setF(q.data);
  }, [q.data]);
  if (!f) return <AdminLayout title="Project" back={{ href: "/admin/portfolio", label: "Portfolio" }}><QueryView query={q}>{() => null}</QueryView></AdminLayout>;
  const set = (p: Any) => setF({ ...f, ...p });
  const nullable = (v: string) => (v.trim() ? v.trim() : null);
  async function save() {
    setMsg(null);
    setErrors({});
    const { id: _id, publishedAt: _p, createdAt: _c, updatedAt: _u, ...rest } = f;
    const body = { ...rest, displayOrder: Number(f.displayOrder) || 0, testimonial: f.testimonial?.quote ? f.testimonial : null };
    try {
      if (isNew) {
        const r = await post<Any>("/admin/portfolio", body);
        navigate(`/admin/portfolio/${r.id}`);
      } else {
        await put(`/admin/portfolio/${params.id}`, body);
        qc.invalidateQueries({ queryKey: ["admin", "portfolio"] });
        qc.invalidateQueries({ queryKey: ["portfolio"] });
        setMsg({ tone: "success", text: "Saved." });
      }
    } catch (e) {
      setErrors(fieldErrors(e));
      setMsg({ tone: "danger", text: errorMessage(e) });
    }
  }
  return (
    <AdminLayout title={isNew ? "New case study" : f.title} back={{ href: "/admin/portfolio", label: "Portfolio" }} actions={!isNew && <a href={`/products/${f.slug}`} target="_blank" rel="noreferrer" className="text-[13px] underline self-center">View page</a>}>
      <div className="space-y-6 max-w-[980px]">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="Title" value={f.title} onChange={(e) => set({ title: e.target.value })} error={errors.title} />
          <TextField label="Slug" value={f.slug} onChange={(e) => set({ slug: e.target.value })} error={errors.slug} />
          <TextArea label="Short description" rows={2} className="md:col-span-2" value={f.shortDescription} onChange={(e) => set({ shortDescription: e.target.value })} />
          <SelectField label="Status label" value={f.statusLabel} onChange={(e) => set({ statusLabel: e.target.value })} options={[{ value: "live", label: "Live" }, { value: "in_development", label: "In development" }, { value: "concept", label: "Concept" }, { value: "internal_tool", label: "Internal tool" }]} />
          <SelectField label="Publication" value={f.publicationStatus} onChange={(e) => set({ publicationStatus: e.target.value })} options={[{ value: "draft", label: "Draft" }, { value: "published", label: "Published" }, { value: "archived", label: "Archived" }]} />
          <TextField label="Industry / sector" value={f.industry} onChange={(e) => set({ industry: e.target.value })} />
          <TextField label="Project type" value={f.projectType} onChange={(e) => set({ projectType: e.target.value })} />
          <TextField label="Stack (display)" value={f.stack} onChange={(e) => set({ stack: e.target.value })} />
          <TextField label="Technology tags" value={f.technologyTags.join(", ")} onChange={(e) => set({ technologyTags: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) })} hint="Comma separated" />
          <TextField label="External URL" value={f.externalUrl ?? ""} onChange={(e) => set({ externalUrl: nullable(e.target.value) })} error={errors.externalUrl} />
          <TextField label="Access note (if not public)" value={f.accessNote ?? ""} onChange={(e) => set({ accessNote: nullable(e.target.value) })} />
          <TextField label="Thumbnail URL" value={f.thumbnailUrl ?? ""} onChange={(e) => set({ thumbnailUrl: nullable(e.target.value) })} hint="e.g. /screens/name.png" />
          <TextField label="Hero image URL" value={f.heroUrl ?? ""} onChange={(e) => set({ heroUrl: nullable(e.target.value) })} />
          <TextField label="Logo URL" value={f.logoUrl ?? ""} onChange={(e) => set({ logoUrl: nullable(e.target.value) })} />
          <TextField label="Display order" type="number" value={f.displayOrder} onChange={(e) => set({ displayOrder: e.target.value })} />
          <fieldset className="md:col-span-2">
            <legend className="text-[13px] font-medium mb-2">Service categories</legend>
            <div className="flex flex-wrap gap-4">{(services.data ?? []).map((s) => (<Checkbox key={s.slug} label={s.name} checked={f.serviceCategorySlugs.includes(s.slug)} onChange={(e) => set({ serviceCategorySlugs: e.target.checked ? [...f.serviceCategorySlugs, s.slug] : f.serviceCategorySlugs.filter((x: string) => x !== s.slug) })} />))}</div>
          </fieldset>
          <Checkbox label="Featured (flagship)" checked={f.featured} onChange={(e) => set({ featured: e.target.checked })} />
        </Card>
        <Card className="p-5 space-y-4">
          <TextArea label="The challenge (Markdown)" rows={4} value={f.challenge} onChange={(e) => set({ challenge: e.target.value })} />
          <TextArea label="Our approach (Markdown)" rows={4} value={f.approach} onChange={(e) => set({ approach: e.target.value })} />
          <TextArea label="The solution (Markdown)" rows={4} value={f.solution} onChange={(e) => set({ solution: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <LinesField key={`f-${f.id}`} label="Key features" value={f.features} onChange={(v) => set({ features: v })} />
            <LinesField key={`o-${f.id}`} label="Verified outcomes" value={f.outcomes} onChange={(v) => set({ outcomes: v })} hint="Only outcomes you can evidence. One per line." />
          </div>
          <TextArea label="Long-form body (Markdown, optional)" rows={8} value={f.bodyMarkdown} onChange={(e) => set({ bodyMarkdown: e.target.value })} hint="Raw HTML is not rendered. For the six original case studies the bundled long-form page is used unless this is filled." />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TextField label="Testimonial quote" className="md:col-span-3" value={f.testimonial?.quote ?? ""} onChange={(e) => set({ testimonial: { ...(f.testimonial ?? { author: "" }), quote: e.target.value } })} />
            <TextField label="Author" value={f.testimonial?.author ?? ""} onChange={(e) => set({ testimonial: { ...(f.testimonial ?? { quote: "" }), author: e.target.value } })} />
            <TextField label="Role" value={f.testimonial?.role ?? ""} onChange={(e) => set({ testimonial: { ...(f.testimonial ?? { quote: "", author: "" }), role: e.target.value } })} />
            <TextField label="Company" value={f.testimonial?.company ?? ""} onChange={(e) => set({ testimonial: { ...(f.testimonial ?? { quote: "", author: "" }), company: e.target.value } })} />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <TextField label="SEO title" value={f.seoTitle ?? ""} onChange={(e) => set({ seoTitle: nullable(e.target.value) })} />
            <TextField label="SEO description" value={f.seoDescription ?? ""} onChange={(e) => set({ seoDescription: nullable(e.target.value) })} />
          </div>
        </Card>
        <div className="flex justify-end"><Btn onClick={save}>{isNew ? "Create" : "Save"}</Btn></div>
      </div>
    </AdminLayout>
  );
}

// ================================================================ services & FAQs
export function AdminContent() {
  const [tab, setTab] = useState<"services" | "faqs">("services");
  const qc = useQueryClient();
  const services = useQuery({ queryKey: ["admin", "services"], queryFn: () => get<Any[]>("/admin/services") });
  const faqs = useQuery({ queryKey: ["admin", "faqs"], queryFn: () => get<Any[]>("/admin/faqs") });
  const [svc, setSvc] = useState<Any | null>(null);
  const [faq, setFaq] = useState<Any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return (
    <AdminLayout title="Services & FAQs">
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[{ key: "services", label: "Service categories" }, { key: "faqs", label: "FAQs" }]} />
      {err && <Alert tone="danger" className="mb-4">{err}</Alert>}
      {tab === "services" ? (
        <>
          <div className="flex justify-end mb-3"><Btn size="sm" onClick={() => setSvc({ slug: "", name: "", eyebrow: "", headline: "", summary: "", description: "", audiences: [], deliverables: [], displayOrder: 0, active: true })}><Plus size={14} /> Service</Btn></div>
          <QueryView query={services}>{(list) => (<Table head={["Service", "Order", "Active", ""]}>{list.map((s) => (<tr key={s.id}><Td><span className="font-medium">{s.name}</span><span className="block text-[12px] text-muted">{s.summary.slice(0, 120)}</span></Td><Td>{s.displayOrder}</Td><Td>{s.active ? "Yes" : "No"}</Td><Td><Btn size="sm" variant="ghost" onClick={() => setSvc(s)}>Edit</Btn></Td></tr>))}</Table>)}</QueryView>
        </>
      ) : (
        <>
          <div className="flex justify-end mb-3"><Btn size="sm" onClick={() => setFaq({ scope: "home", question: "", answer: "", displayOrder: 0, published: true })}><Plus size={14} /> FAQ</Btn></div>
          <QueryView query={faqs}>{(list) => (<Table head={["Scope", "Question", "Published", ""]}>{list.map((f) => (<tr key={f.id}><Td><Badge>{f.scope}</Badge></Td><Td>{f.question}</Td><Td>{f.published ? "Yes" : "No"}</Td><Td><Btn size="sm" variant="ghost" onClick={() => setFaq(f)}>Edit</Btn></Td></tr>))}</Table>)}</QueryView>
        </>
      )}
      <Modal open={Boolean(svc)} onOpenChange={(v) => !v && setSvc(null)} title={svc?.id ? "Edit service" : "New service"} wide footer={<Btn size="sm" onClick={async () => { try { const { id, ...b } = svc; if (id) await put(`/admin/services/${id}`, { ...b, displayOrder: Number(b.displayOrder) || 0 }); else await post("/admin/services", { ...b, displayOrder: Number(b.displayOrder) || 0 }); setSvc(null); qc.invalidateQueries({ queryKey: ["admin", "services"] }); qc.invalidateQueries({ queryKey: ["services"] }); } catch (e) { setErr(errorMessage(e)); setSvc(null); } }}>Save</Btn>}>
        {svc && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <TextField label="Name" value={svc.name} onChange={(e) => setSvc({ ...svc, name: e.target.value })} />
            <TextField label="Slug" value={svc.slug} onChange={(e) => setSvc({ ...svc, slug: e.target.value })} />
            <TextField label="Eyebrow" value={svc.eyebrow} onChange={(e) => setSvc({ ...svc, eyebrow: e.target.value })} />
            <TextField label="Headline" value={svc.headline} onChange={(e) => setSvc({ ...svc, headline: e.target.value })} />
            <TextArea label="Summary" rows={3} className="sm:col-span-2" value={svc.summary} onChange={(e) => setSvc({ ...svc, summary: e.target.value })} />
            <TextArea label="Description" rows={3} className="sm:col-span-2" value={svc.description} onChange={(e) => setSvc({ ...svc, description: e.target.value })} />
            <LinesField label="Audiences" value={svc.audiences} onChange={(v) => setSvc({ ...svc, audiences: v })} rows={3} />
            <LinesField label="Deliverables" value={svc.deliverables} onChange={(v) => setSvc({ ...svc, deliverables: v })} rows={3} />
            <TextField label="Display order" type="number" value={svc.displayOrder} onChange={(e) => setSvc({ ...svc, displayOrder: e.target.value })} />
            <Checkbox label="Active" checked={svc.active} onChange={(e) => setSvc({ ...svc, active: e.target.checked })} />
          </div>
        )}
      </Modal>
      <Modal open={Boolean(faq)} onOpenChange={(v) => !v && setFaq(null)} title={faq?.id ? "Edit FAQ" : "New FAQ"} footer={<>{faq?.id && <Btn size="sm" variant="ghost" onClick={async () => { await del(`/admin/faqs/${faq.id}`); setFaq(null); qc.invalidateQueries({ queryKey: ["admin", "faqs"] }); }}>Delete</Btn>}<Btn size="sm" onClick={async () => { try { const { id, ...b } = faq; const body = { scope: b.scope, question: b.question, answer: b.answer, displayOrder: Number(b.displayOrder) || 0, published: b.published }; if (id) await put(`/admin/faqs/${id}`, body); else await post("/admin/faqs", body); setFaq(null); qc.invalidateQueries({ queryKey: ["admin", "faqs"] }); } catch (e) { setErr(errorMessage(e)); setFaq(null); } }}>Save</Btn></>}>
        {faq && (
          <div className="space-y-3">
            <TextField label="Scope" value={faq.scope} onChange={(e) => setFaq({ ...faq, scope: e.target.value })} hint="home, packages, configurator, or package:<slug>" />
            <TextField label="Question" value={faq.question} onChange={(e) => setFaq({ ...faq, question: e.target.value })} />
            <TextArea label="Answer" rows={4} value={faq.answer} onChange={(e) => setFaq({ ...faq, answer: e.target.value })} />
            <div className="flex gap-4 items-end"><TextField label="Order" type="number" value={faq.displayOrder} onChange={(e) => setFaq({ ...faq, displayOrder: e.target.value })} /><Checkbox label="Published" checked={faq.published} onChange={(e) => setFaq({ ...faq, published: e.target.checked })} /></div>
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}

// ================================================================ users
export function AdminUsers() {
  const { me, can } = useAuth();
  const qc = useQueryClient();
  const [role, setRole] = useState("");
  const [search, setSearch] = useState("");
  const qs = new URLSearchParams({ ...(role && { role }), ...(search && { q: search }) }).toString();
  const list = useCursorList<Any>(["admin", "users", qs], `/admin/users?${qs}`);
  const [invite, setInvite] = useState<Any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const myRole = (me?.role ?? "client") as Role;
  const assignable = ROLES.filter((r) => canAssignRole(myRole, r));
  return (
    <AdminLayout title="Users & roles" actions={can("users.manage") && <Btn size="sm" onClick={() => setInvite({ name: "", email: "", role: "staff", sendInvite: true })}>Invite user</Btn>}>
      {err && <Alert tone="danger" className="mb-4">{err}</Alert>}
      <FilterBar>
        <TextField label="Search" value={search} onChange={(e) => setSearch(e.target.value)} />
        <SelectField label="Role" value={role} onChange={(e) => setRole(e.target.value)} placeholder="All" options={ROLES.map((r) => ({ value: r, label: humanize(r) }))} />
      </FilterBar>
      <CursorList q={list} empty={<EmptyState title="No users" />}>
        {(items) => (
          <Table head={["User", "Role", "Status", "Email", "MFA", "Last sign-in"]}>
            {items.map((u) => (
              <tr key={u.id}>
                <Td><span className="font-medium">{u.name}</span><span className="block text-[12px] text-muted">{u.email}</span></Td>
                <Td>
                  {can("users.manage") && u.id !== me?.id && canAssignRole(myRole, u.role) ? (
                    <select aria-label={`Role for ${u.name}`} value={u.role} onChange={async (e) => { try { await patch(`/admin/users/${u.id}`, { role: e.target.value }); qc.invalidateQueries({ queryKey: ["admin", "users"] }); } catch (x) { setErr(errorMessage(x)); } }} className="text-[13px] border border-rule rounded-sm px-2 py-1 bg-white">
                      {assignable.map((r) => (<option key={r} value={r}>{humanize(r)}</option>))}
                    </select>
                  ) : (
                    <Badge>{u.role}</Badge>
                  )}
                </Td>
                <Td>
                  <StatusBadge status={u.status} />
                  {can("users.manage") && u.id !== me?.id && canAssignRole(myRole, u.role) && (
                    <Btn size="sm" variant="ghost" onClick={async () => { await patch(`/admin/users/${u.id}`, { status: u.status === "active" ? "disabled" : "active" }); qc.invalidateQueries({ queryKey: ["admin", "users"] }); }}>{u.status === "active" ? "Disable" : "Enable"}</Btn>
                  )}
                </Td>
                <Td>{u.emailVerifiedAt ? "Verified" : <span className="text-faint">Unverified</span>}</Td>
                <Td>{u.mfaEnabledAt ? "On" : "—"}</Td>
                <Td>{dateTime(u.lastLoginAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </CursorList>
      <Modal open={Boolean(invite)} onOpenChange={(v) => !v && setInvite(null)} title="Invite a user" footer={<Btn size="sm" onClick={async () => { try { await post("/admin/users", invite); setInvite(null); qc.invalidateQueries({ queryKey: ["admin", "users"] }); } catch (e) { setErr(errorMessage(e)); setInvite(null); } }}>Send invitation</Btn>}>
        {invite && (
          <div className="space-y-3">
            <TextField label="Name" value={invite.name} onChange={(e) => setInvite({ ...invite, name: e.target.value })} />
            <TextField label="Email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
            <SelectField label="Role" value={invite.role} onChange={(e) => setInvite({ ...invite, role: e.target.value })} options={assignable.map((r) => ({ value: r, label: humanize(r) }))} />
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}

// ================================================================ audit & emails
export function AdminAudit() {
  const [entityType, setEntityType] = useState("");
  const [action, setAction] = useState("");
  const qs = new URLSearchParams({ ...(entityType && { entityType }), ...(action && { action }) }).toString();
  const list = useCursorList<Any>(["admin", "audit", qs], `/admin/audit?${qs}`);
  return (
    <AdminLayout title="Audit log" description="Append-only record of security-, finance- and permission-sensitive actions.">
      <FilterBar>
        <SelectField label="Entity" value={entityType} onChange={(e) => setEntityType(e.target.value)} placeholder="All" options={["user", "lead", "proposal", "order", "invoice", "payment_transaction", "refund", "project", "package", "pricing_rule_version", "settings", "project_file"].map((s) => ({ value: s, label: humanize(s) }))} />
        <TextField label="Action contains" value={action} onChange={(e) => setAction(e.target.value)} />
      </FilterBar>
      <CursorList q={list} empty={<EmptyState title="No events" />}>
        {(items) => (
          <Table head={["When", "Actor", "Action", "Entity", "Details"]} minWidth={900}>
            {items.map((e) => (<tr key={e.id}><Td className="whitespace-nowrap">{dateTime(e.createdAt)}</Td><Td>{e.actorName ?? e.actorRole}<span className="block text-[12px] text-muted">{e.ip}</span></Td><Td><code className="text-[12px]">{e.action}</code></Td><Td>{humanize(e.entityType)}<span className="block text-[11px] text-muted break-all">{e.entityId}</span></Td><Td>{e.reason && <p className="text-[12px]">Reason: {e.reason}</p>}{(e.before || e.after) && <details className="text-[11px]"><summary className="cursor-pointer text-muted">Changes</summary><pre className="whitespace-pre-wrap break-all max-w-[420px]">{JSON.stringify({ before: e.before, after: e.after }, null, 1)}</pre></details>}</Td></tr>))}
          </Table>
        )}
      </CursorList>
    </AdminLayout>
  );
}

export function AdminEmails() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const list = useCursorList<Any>(["admin", "emails", status], `/admin/notifications${status ? `?status=${status}` : ""}`);
  return (
    <AdminLayout title="Email log" actions={<Btn size="sm" variant="secondary" onClick={async () => { await post("/admin/notifications/dispatch"); qc.invalidateQueries({ queryKey: ["admin", "emails"] }); }}>Send queued now</Btn>}>
      <FilterBar><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={["queued", "sent", "failed", "skipped"].map((s) => ({ value: s, label: humanize(s) }))} /></FilterBar>
      <CursorList q={list} empty={<EmptyState title="No emails" />}>
        {(items) => (
          <Table head={["Created", "To", "Template", "Subject", "Status", "Attempts"]}>
            {items.map((n) => (<tr key={n.id}><Td className="whitespace-nowrap">{dateTime(n.createdAt)}</Td><Td>{n.toEmail}</Td><Td><code className="text-[12px]">{n.template}</code></Td><Td>{n.subject}</Td><Td><StatusBadge status={n.status} />{n.error && <span className="block text-[11px] text-[#9F1D1D]">{n.error}</span>}</Td><Td>{n.attempts}</Td></tr>))}
          </Table>
        )}
      </CursorList>
    </AdminLayout>
  );
}

// ================================================================ settings
export function AdminSettings() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin", "settings"], queryFn: () => get<Any>("/admin/settings") });
  const [tab, setTab] = useState<"business" | "commerce" | "tax" | "security" | "configurator">("business");
  const [draft, setDraft] = useState<Any>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  useEffect(() => {
    if (q.data) setDraft(JSON.parse(JSON.stringify(q.data)));
  }, [q.data]);
  if (!draft) return <AdminLayout title="Settings"><QueryView query={q}>{() => null}</QueryView></AdminLayout>;
  const highRisk = (draft._highRisk as string[]).includes(tab);
  const locked = highRisk && !can("settings.high_risk");
  const s = draft[tab];
  const set = (p: Any) => setDraft({ ...draft, [tab]: { ...s, ...p } });
  async function save() {
    setMsg(null);
    try {
      await put(`/admin/settings/${tab}`, { value: draft[tab] });
      setMsg({ tone: "success", text: "Settings saved." });
      qc.invalidateQueries({ queryKey: ["admin", "settings"] });
      qc.invalidateQueries({ queryKey: ["settings", "public"] });
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    }
  }
  return (
    <AdminLayout title="Settings" description={<>Email: {draft._email} · File storage: {draft._storage}</>}>
      <Tabs value={tab} onChange={(t) => { setTab(t); setMsg(null); }} tabs={[{ key: "business", label: "Business" }, { key: "commerce", label: "Commerce & payments" }, { key: "tax", label: "Tax / VAT" }, { key: "security", label: "Security" }, { key: "configurator", label: "Configurator" }]} />
      <div className="max-w-[860px] space-y-6">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {locked && <Alert tone="info">Only the owner can change {tab} settings.</Alert>}
        <fieldset disabled={locked}>
          {tab === "business" && (
            <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
              <TextField label="Trading name" value={s.tradingName} onChange={(e) => set({ tradingName: e.target.value })} />
              <TextField label="Legal name" value={s.legalName} onChange={(e) => set({ legalName: e.target.value })} />
              <TextField label="Company registration no." value={s.registrationNumber} onChange={(e) => set({ registrationNumber: e.target.value })} />
              <TextField label="Phone" value={s.phone} onChange={(e) => set({ phone: e.target.value })} />
              <TextField label="General email" value={s.email} onChange={(e) => set({ email: e.target.value })} />
              <TextField label="Legal / privacy email" value={s.legalEmail} onChange={(e) => set({ legalEmail: e.target.value })} />
              <LinesField key="addr" label="Address lines" value={s.address} onChange={(v) => set({ address: v })} rows={3} />
              <LinesField key="hours" label="Hours" value={s.hours} onChange={(v) => set({ hours: v })} rows={3} />
              <TextField label="Cal.com link" value={s.calLink} onChange={(e) => set({ calLink: e.target.value })} hint="e.g. yourname/30-minute-consultation" />
              <TextField label="LinkedIn URL" value={s.linkedinUrl} onChange={(e) => set({ linkedinUrl: e.target.value })} />
              <LinesField key="alerts" label="Staff alert emails" value={s.staffAlertEmails} onChange={(v) => set({ staffAlertEmails: v })} rows={2} hint="New leads, payments and requests are sent here. One per line." />
            </Card>
          )}
          {tab === "commerce" && (
            <div className="space-y-6">
              <Card className="p-5 space-y-4">
                <h3 className="font-serif text-[18px]">Payment providers</h3>
                <div className="space-y-2">
                  {draft._providers.map((p: Any) => (
                    <div key={p.key} className="flex flex-wrap items-center gap-3">
                      <Checkbox label={p.label} checked={s.enabledProviders.includes(p.key)} onChange={(e) => set({ enabledProviders: e.target.checked ? [...s.enabledProviders, p.key] : s.enabledProviders.filter((x: string) => x !== p.key) })} />
                      {p.configured ? <Badge tone="success">Credentials configured</Badge> : <Badge tone="warning">Credentials missing (server env)</Badge>}
                    </div>
                  ))}
                </div>
                <SelectField label="Default provider" value={s.defaultProvider ?? ""} onChange={(e) => set({ defaultProvider: e.target.value || null })} placeholder="None" options={s.enabledProviders.map((p: string) => ({ value: p, label: humanize(p) }))} className="max-w-[300px]" />
                <p className="text-[12px] text-muted">Credentials are environment variables on the server and are never stored in or shown by the console.</p>
              </Card>
              <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
                <h3 className="font-serif text-[18px] md:col-span-2">EFT bank details (shown to clients)</h3>
                {(["bankName", "accountName", "accountNumber", "branchCode", "accountType"] as const).map((k) => (<TextField key={k} label={humanize(k.replace(/([A-Z])/g, "_$1").toLowerCase())} value={s.eft[k]} onChange={(e) => set({ eft: { ...s.eft, [k]: e.target.value } })} />))}
              </Card>
              <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
                <TextField label="Terms version" value={s.termsVersion} onChange={(e) => set({ termsVersion: e.target.value })} hint="Change when terms change — customers must re-accept." />
                <TextField label="Invoice due (days)" type="number" value={s.invoiceDueDays} onChange={(e) => set({ invoiceDueDays: Number(e.target.value) })} />
                <TextField label="Proposal validity (days)" type="number" value={s.proposalExpiryDays} onChange={(e) => set({ proposalExpiryDays: Number(e.target.value) })} />
                <TextField label={`Default deposit (${percent(s.defaultDepositBps)})`} type="number" value={s.defaultDepositBps / 100} onChange={(e) => set({ defaultDepositBps: Math.round(Number(e.target.value) * 100) })} />
                <TextArea label="Terms summary (proposals)" rows={3} className="md:col-span-3" value={s.termsSummary} onChange={(e) => set({ termsSummary: e.target.value })} />
                <TextArea label="Refund policy summary (checkout)" rows={3} className="md:col-span-3" value={s.refundPolicySummary} onChange={(e) => set({ refundPolicySummary: e.target.value })} />
              </Card>
            </div>
          )}
          {tab === "tax" && (
            <Card className="p-5 space-y-4">
              <Alert tone="warning">Only enable VAT once your accountant has confirmed registration and invoice treatment. Tax is applied only when both switches below are on. Existing invoices and accepted proposals keep their tax snapshot.</Alert>
              <Checkbox label="Charge VAT" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <TextField label="Rate (%)" type="number" value={s.rateBps / 100} onChange={(e) => set({ rateBps: Math.round(Number(e.target.value) * 100) })} />
                <TextField label="Label" value={s.label} onChange={(e) => set({ label: e.target.value })} />
                <TextField label="VAT number" value={s.vatNumber ?? ""} onChange={(e) => set({ vatNumber: e.target.value || null })} />
              </div>
              <Checkbox label="Prices entered in the console already include VAT" checked={s.pricesIncludeTax} onChange={(e) => set({ pricesIncludeTax: e.target.checked })} />
              <Checkbox label="I confirm this VAT treatment has been approved by our accountant/tax adviser" checked={s.confirmedByOwner} onChange={(e) => set({ confirmedByOwner: e.target.checked })} />
            </Card>
          )}
          {tab === "security" && (
            <Card className="p-5 space-y-4">
              <Checkbox label="Require two-factor authentication for all staff" hint="Staff without MFA are asked to enrol before using the console." checked={s.requireStaffMfa} onChange={(e) => set({ requireStaffMfa: e.target.checked })} />
              <TextField label="Session length (days)" type="number" min={1} max={90} value={s.sessionDays} onChange={(e) => set({ sessionDays: Number(e.target.value) })} className="max-w-[220px]" />
            </Card>
          )}
          {tab === "configurator" && (
            <Card className="p-5 space-y-4">
              <Checkbox label="Configurator enabled on the public site" checked={s.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              <p className="text-[13px] text-muted">Pricing coefficients are managed under <Link href="/admin/pricing" className="underline">Pricing rules</Link>.</p>
            </Card>
          )}
        </fieldset>
        {!locked && <div className="flex justify-end"><Btn onClick={save}>Save {tab} settings</Btn></div>}
      </div>
    </AdminLayout>
  );
}
