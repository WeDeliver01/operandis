import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus } from "lucide-react";
import { PROJECT_STATUSES, PROJECT_STATUS_LABELS, MILESTONE_STATUSES } from "@workspace/domain";
import { AdminLayout, CursorList, FilterBar, Table, Tabs, Td, useCursorList } from "./AdminLayout";
import { get, patch, post, api, downloadFile, errorMessage, newIdempotencyKey } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money, randToMinor, relative, humanize, fileSize } from "@/lib/format";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, Checkbox, DefinitionList, SelectField, Stat, StatusBadge, TextArea, TextField } from "@/components/ui-kit";
import { ConfirmButton, Modal } from "@/components/ui-kit/overlay";
import { MilestoneTimeline, ProgressBar } from "@/components/commerce";
import { openFile } from "@/pages/portal/PortalPages";
import { useStaff } from "./AdminCrm";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ================================================================ projects
export function AdminProjects() {
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["admin", "projects", status], queryFn: () => get<Any[]>(`/admin/projects${status ? `?status=${status}` : ""}`) });
  return (
    <AdminLayout title="Projects">
      <FilterBar><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={PROJECT_STATUSES.map((s) => ({ value: s, label: PROJECT_STATUS_LABELS[s] }))} /></FilterBar>
      <QueryView query={q} empty={<EmptyState title="No projects">Projects are created automatically when a package is paid or a proposal is accepted.</EmptyState>}>
        {(list) => (
          <Table head={["Project", "Client", "Manager", "Status", "Progress", "Target", "Value"]}>
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/projects/${p.id}`} className="font-medium hover:underline">{p.name}</Link><span className="block text-[12px] text-muted">{p.reference}</span></Td>
                <Td>{p.client}</Td>
                <Td>{p.managerName ?? <span className="text-faint">—</span>}</Td>
                <Td><StatusBadge status={p.status} label={PROJECT_STATUS_LABELS[p.status as keyof typeof PROJECT_STATUS_LABELS]} /></Td>
                <Td className="w-[140px]"><ProgressBar value={p.progressPct} /><span className="text-[12px] text-muted">{p.progressPct}%</span></Td>
                <Td>{date(p.targetDate)}</Td>
                <Td>{money(p.contractValueMinor)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryView>
    </AdminLayout>
  );
}

export function AdminProject({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const staff = useStaff();
  const q = useQuery({ queryKey: ["admin", "project", params.id], queryFn: () => get<Any>(`/admin/projects/${params.id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "project", params.id] });
  const [msg, setMsg] = useState<string | null>(null);
  const [update, setUpdate] = useState({ body: "", internal: false, kind: "update" });
  const [msOpen, setMsOpen] = useState(false);
  const [ms, setMs] = useState({ key: "", title: "", description: "", amountRand: "", billable: false, targetDate: "" });
  const [uploadVis, setUploadVis] = useState("client");
  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <AdminLayout title={q.data?.project.name ?? "Project"} back={{ href: "/admin/projects", label: "Projects" }} description={q.data && <>{q.data.project.reference} · {q.data.organization?.name}</>}>
      <QueryView query={q}>
        {(d) => {
          const p = d.project;
          return (
            <div className="space-y-6">
              {msg && <Alert tone="danger">{msg}</Alert>}
              {p.depositRequired && !p.depositPaid && (
                <Alert tone="warning" title="Deposit not yet paid">
                  Work can't move to In progress until the deposit invoice is paid{p.depositExceptionReason ? "" : " or an exception is approved"}.
                  {p.depositExceptionReason && <span className="block mt-1">Exception recorded: {p.depositExceptionReason}</span>}
                  {!p.depositExceptionReason && can("projects.deposit_exception") && (
                    <span className="block mt-2"><ConfirmButton title="Approve a deposit exception" description="Work may start before the deposit is paid. This is recorded in the audit log." requireReason="Reason (required)" confirmLabel="Approve exception" onConfirm={(reason) => act(() => post(`/admin/projects/${params.id}/deposit-exception`, { reason }))}>Approve exception</ConfirmButton></span>
                  )}
                </Alert>
              )}
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
                <Card className="p-4 lg:col-span-2 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <SelectField label="Status" value={p.status} onChange={(e) => act(() => patch(`/admin/projects/${params.id}`, { status: e.target.value }))} options={[p.status, ...p.nextStatuses].map((s: string) => ({ value: s, label: PROJECT_STATUS_LABELS[s as keyof typeof PROJECT_STATUS_LABELS] }))} />
                    <SelectField label="Manager" value={p.managerId ?? ""} placeholder="Unassigned" onChange={(e) => act(() => patch(`/admin/projects/${params.id}`, { managerId: e.target.value || null }))} options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
                    <TextField label="Progress %" type="number" min={0} max={100} defaultValue={p.progressPct} onBlur={(e) => act(() => patch(`/admin/projects/${params.id}`, { progressPct: Number(e.target.value) }))} />
                    <TextField label="Target date" type="date" defaultValue={p.targetDate ? p.targetDate.slice(0, 10) : ""} onBlur={(e) => act(() => patch(`/admin/projects/${params.id}`, { targetDate: e.target.value ? new Date(e.target.value).toISOString() : null }))} />
                  </div>
                </Card>
                <Stat label="Contract value" value={money(p.contractValueMinor)} />
                <Stat label="Invoiced / paid" value={money(d.invoices.reduce((s: number, i: Any) => s + i.amountPaidMinor, 0))} hint={`of ${money(d.invoices.filter((i: Any) => i.status !== "void").reduce((s: number, i: Any) => s + i.totalMinor, 0))} invoiced`} />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
                <div className="space-y-6 min-w-0">
                  <Card>
                    <CardHeader title="Milestones" actions={<Btn size="sm" variant="ghost" onClick={() => setMsOpen(true)}><Plus size={14} /> Milestone</Btn>} />
                    <div className="p-5">
                      <MilestoneTimeline
                        items={d.milestones}
                        actions={(m) => {
                          const full = d.milestones.find((x: Any) => x.id === m.id);
                          return (
                            <div className="flex flex-wrap gap-2 items-center">
                              <select aria-label={`Status of ${m.title}`} value={m.status} onChange={(e) => act(() => patch(`/admin/projects/${params.id}/milestones/${m.id}`, { status: e.target.value }))} className="text-[12px] border border-rule rounded-sm px-2 py-1 bg-white">
                                {MILESTONE_STATUSES.map((s) => (<option key={s} value={s}>{humanize(s)}</option>))}
                              </select>
                              {full.visibility === "internal" && <Badge>Internal</Badge>}
                              {full.billable && !full.invoiceId && can("invoices.manage") && <Btn size="sm" variant="secondary" onClick={() => act(() => post(`/admin/projects/${params.id}/milestones/${m.id}/invoice`, {}))}>Issue invoice ({money(full.amountMinor)})</Btn>}
                              {full.invoiceId && <Link href={`/admin/invoices/${full.invoiceId}`} className="text-[12px] underline">View invoice</Link>}
                            </div>
                          );
                        }}
                      />
                    </div>
                  </Card>
                  <Card>
                    <CardHeader title="Updates & internal notes" />
                    <form className="p-5 border-b hairline space-y-3" onSubmit={async (e) => { e.preventDefault(); await act(() => post(`/admin/projects/${params.id}/messages`, update)); setUpdate({ body: "", internal: false, kind: "update" }); }}>
                      <TextArea label="Post an update" rows={3} value={update.body} onChange={(e) => setUpdate({ ...update, body: e.target.value })} />
                      <Checkbox label="Internal note — not visible to the client" checked={update.internal} onChange={(e) => setUpdate({ ...update, internal: e.target.checked })} />
                      <Btn type="submit" size="sm" disabled={!update.body.trim()}>{update.internal ? "Add note" : "Send update to client"}</Btn>
                    </form>
                    <ul className="divide-y hairline">
                      {d.thread.map((m: Any) => (
                        <li key={m.id} className={`px-5 py-3.5 text-[14px] ${m.internal ? "bg-[#FBF1E1]/40" : ""}`}>
                          <div className="flex flex-wrap gap-2 items-center text-[12px] text-muted"><span className="text-ink">{m.authorName ?? "System"}</span>{m.internal && <Badge tone="warning">Internal</Badge>}{m.kind !== "message" && <Badge>{m.kind}</Badge>}<span>{relative(m.createdAt)}</span></div>
                          <p className="mt-1 whitespace-pre-line">{m.body}</p>
                        </li>
                      ))}
                    </ul>
                  </Card>
                </div>
                <div className="space-y-6">
                  <Card>
                    <CardHeader title="Files" />
                    <div className="p-5 space-y-3">
                      <div className="flex flex-wrap gap-2 items-end">
                        <SelectField label="Visibility" value={uploadVis} onChange={(e) => setUploadVis(e.target.value)} options={[{ value: "client", label: "Client can see" }, { value: "internal", label: "Internal only" }]} />
                        <label className="inline-flex items-center gap-2 text-[12px] uppercase tracking-wider font-medium border border-ink px-3 py-2 rounded-sm cursor-pointer relative">
                          Upload
                          <input type="file" className="absolute inset-0 opacity-0 cursor-pointer" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; const fd = new FormData(); fd.append("file", f); fd.append("projectId", params.id); fd.append("visibility", uploadVis); fd.append("kind", uploadVis === "client" ? "deliverable" : "document"); await act(() => api("POST", "/files", fd)); }} />
                        </label>
                      </div>
                      <ul className="divide-y hairline text-[13px]">
                        {d.files.length === 0 && <li className="py-2 text-muted">No files.</li>}
                        {d.files.map((f: Any) => (
                          <li key={f.id} className="py-2.5 flex justify-between gap-2">
                            <span className="min-w-0"><span className="block truncate text-ink">{f.fileName}</span><span className="text-muted">{humanize(f.kind)} · {f.visibility} · {fileSize(f.sizeBytes)}{f.approvedAt ? " · approved" : ""}</span></span>
                            <Btn size="sm" variant="ghost" aria-label={`Download ${f.fileName}`} onClick={() => openFile(f.id)}><Download size={14} /></Btn>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </Card>
                  <Card>
                    <CardHeader title="Invoices" />
                    <ul className="divide-y hairline text-[14px]">
                      {d.invoices.length === 0 && <li className="px-5 py-3 text-muted">None.</li>}
                      {d.invoices.map((i: Any) => (<li key={i.id}><Link href={`/admin/invoices/${i.id}`} className="flex justify-between px-5 py-2.5"><span>{i.number} · {humanize(i.kind)}</span><span>{money(i.totalMinor)} <StatusBadge status={i.status} /></span></Link></li>))}
                    </ul>
                  </Card>
                  <Card>
                    <CardHeader title="Requests" />
                    <ul className="divide-y hairline text-[14px]">
                      {d.changeRequests.length === 0 && <li className="px-5 py-3 text-muted">None.</li>}
                      {d.changeRequests.map((c: Any) => (<li key={c.id} className="px-5 py-2.5 flex justify-between gap-2"><Link href={`/admin/requests?focus=${c.id}`} className="hover:underline">{c.title}</Link><StatusBadge status={c.status} /></li>))}
                    </ul>
                  </Card>
                </div>
              </div>
              <Modal open={msOpen} onOpenChange={setMsOpen} title="Add milestone" footer={<Btn size="sm" disabled={!ms.title} onClick={async () => { await act(() => post(`/admin/projects/${params.id}/milestones`, { key: ms.key || ms.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40), title: ms.title, description: ms.description, amountMinor: randToMinor(ms.amountRand) ?? 0, billable: ms.billable, targetDate: ms.targetDate ? new Date(ms.targetDate).toISOString() : null, displayOrder: d.milestones.length })); setMsOpen(false); }}>Add</Btn>}>
                <div className="space-y-3">
                  <TextField label="Title" value={ms.title} onChange={(e) => setMs({ ...ms, title: e.target.value })} />
                  <TextArea label="Description" rows={2} value={ms.description} onChange={(e) => setMs({ ...ms, description: e.target.value })} />
                  <div className="grid grid-cols-2 gap-3"><TextField label="Amount (R)" value={ms.amountRand} onChange={(e) => setMs({ ...ms, amountRand: e.target.value })} /><TextField label="Target date" type="date" value={ms.targetDate} onChange={(e) => setMs({ ...ms, targetDate: e.target.value })} /></div>
                  <Checkbox label="Billable (an invoice can be issued for this milestone)" checked={ms.billable} onChange={(e) => setMs({ ...ms, billable: e.target.checked })} />
                </div>
              </Modal>
            </div>
          );
        }}
      </QueryView>
    </AdminLayout>
  );
}

// ================================================================ change requests
export function AdminRequests() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["admin", "requests", status], queryFn: () => get<Any[]>(`/admin/change-requests${status ? `?status=${status}` : ""}`) });
  const [editing, setEditing] = useState<Any | null>(null);
  const [form, setForm] = useState({ status: "", response: "", impactRand: "", impactDays: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <AdminLayout title="Support & change requests">
      <FilterBar><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={["open", "triaged", "quoted", "approved", "rejected", "in_progress", "resolved", "closed"].map((s) => ({ value: s, label: humanize(s) }))} /></FilterBar>
      <QueryView query={q} empty={<EmptyState title="No requests" />}>
        {(list) => (
          <Table head={["Request", "Type", "Project", "Priority", "Status", "Raised", ""]}>
            {list.map((c) => (
              <tr key={c.id}>
                <Td><span className="font-medium">{c.title}</span><span className="block text-[12px] text-muted">{c.reference} · {c.client}</span><p className="text-[13px] text-muted mt-1 line-clamp-2 max-w-[360px]">{c.description}</p></Td>
                <Td><Badge tone={c.type === "defect" ? "danger" : c.type === "change" ? "accent" : "neutral"}>{c.type}</Badge></Td>
                <Td><Link href={`/admin/projects/${c.projectId}`} className="underline">{c.projectName}</Link></Td>
                <Td>{humanize(c.priority)}</Td>
                <Td><StatusBadge status={c.status} />{c.impactEstimateMinor ? <span className="block text-[12px] text-muted">{money(c.impactEstimateMinor)}</span> : null}</Td>
                <Td>{relative(c.createdAt)}</Td>
                <Td><Btn size="sm" variant="secondary" onClick={() => { setEditing(c); setErr(null); setForm({ status: c.status, response: c.response ?? "", impactRand: c.impactEstimateMinor ? String(c.impactEstimateMinor / 100) : "", impactDays: c.impactDays ? String(c.impactDays) : "" }); }}>Respond</Btn></Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryView>
      <Modal open={Boolean(editing)} onOpenChange={(v) => !v && setEditing(null)} title={editing?.title ?? ""} description={editing && `${editing.reference} · ${humanize(editing.type)}`} footer={<Btn size="sm" onClick={async () => { try { await patch(`/admin/change-requests/${editing.id}`, { status: form.status, response: form.response, impactEstimateMinor: form.impactRand ? randToMinor(form.impactRand) : null, impactDays: form.impactDays ? Number(form.impactDays) : null }); setEditing(null); qc.invalidateQueries({ queryKey: ["admin", "requests"] }); } catch (e) { setErr(errorMessage(e)); } }}>Save & notify client</Btn>}>
        {editing && (
          <div className="space-y-3">
            <p className="text-[14px] text-muted whitespace-pre-line">{editing.description}</p>
            <SelectField label="Status" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} options={["open", "triaged", "quoted", "approved", "rejected", "in_progress", "resolved", "closed"].map((s) => ({ value: s, label: humanize(s) }))} />
            {editing.type !== "defect" && <div className="grid grid-cols-2 gap-3"><TextField label="Price impact (R)" value={form.impactRand} onChange={(e) => setForm({ ...form, impactRand: e.target.value })} /><TextField label="Schedule impact (days)" type="number" value={form.impactDays} onChange={(e) => setForm({ ...form, impactDays: e.target.value })} /></div>}
            <TextArea label="Response to client" rows={4} value={form.response} onChange={(e) => setForm({ ...form, response: e.target.value })} />
            {err && <Alert tone="danger">{err}</Alert>}
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}

// ================================================================ orders
export function AdminOrders() {
  const [status, setStatus] = useState("");
  const qs = status ? `status=${status}` : "";
  const list = useCursorList<Any>(["admin", "orders", qs], `/admin/orders?${qs}`);
  return (
    <AdminLayout title="Orders">
      <FilterBar><SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={["pending_payment", "confirmed", "in_progress", "completed", "cancelled", "refunded", "partially_refunded"].map((s) => ({ value: s, label: humanize(s) }))} /></FilterBar>
      <CursorList q={list} empty={<EmptyState title="No orders" />}>
        {(items) => (
          <Table head={["Order", "Client", "Item", "Source", "Total", "Status", "Created"]}>
            {items.map((o) => (
              <tr key={o.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/orders/${o.id}`} className="font-medium hover:underline">{o.reference}</Link></Td>
                <Td>{o.client}</Td>
                <Td>{o.title}</Td>
                <Td>{humanize(o.source)}</Td>
                <Td>{money(o.totalMinor)}</Td>
                <Td><StatusBadge status={o.status} /></Td>
                <Td>{date(o.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </CursorList>
    </AdminLayout>
  );
}

export function AdminOrder({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["admin", "order", params.id], queryFn: () => get<Any>(`/admin/orders/${params.id}`) });
  return (
    <AdminLayout title={q.data ? `Order ${q.data.order.reference}` : "Order"} back={{ href: "/admin/orders", label: "Orders" }} actions={q.data && can("orders.manage") && ["pending_payment", "confirmed"].includes(q.data.order.status) && <ConfirmButton title="Cancel this order?" requireReason="Reason" danger confirmLabel="Cancel order" onConfirm={async (reason) => { await post(`/admin/orders/${params.id}/cancel`, { reason }); qc.invalidateQueries({ queryKey: ["admin", "order", params.id] }); }}>Cancel order</ConfirmButton>}>
      <QueryView query={q}>
        {(d) => (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Card className="p-5"><DefinitionList items={[["Status", <StatusBadge key="s" status={d.order.status} />], ["Client", d.organization?.name], ["Billing", `${d.order.billingDetails.name} <${d.order.billingDetails.email}>`], ["Source", humanize(d.order.source)], ["Package version", d.order.packageVersion ?? "—"], ["Total", money(d.order.totalMinor)], ["Deposit", money(d.order.depositMinor)], ["Terms", `${d.order.termsVersion ?? "—"} (accepted ${dateTime(d.order.termsAcceptedAt)})`], ["Project", d.project ? <Link key="p" href={`/admin/projects/${d.project.id}`} className="underline">{d.project.name}</Link> : "—"], ["Created", dateTime(d.order.createdAt)]]} /></Card>
            <Card><CardHeader title="Items (snapshot)" /><ul className="divide-y hairline text-[14px]">{d.items.map((i: Any) => (<li key={i.id} className="px-5 py-2.5 flex justify-between gap-3"><span>{i.description}</span><span>{money(i.totalMinor)}</span></li>))}</ul></Card>
            <Card><CardHeader title="Payment attempts" /><ul className="divide-y hairline text-[13px]">{d.attempts.map((a: Any) => (<li key={a.id} className="px-5 py-2.5 flex justify-between gap-2"><span>{a.reference} · {a.provider} · {money(a.amountMinor)}<span className="block text-muted">{dateTime(a.createdAt)}{a.failureReason ? ` — ${a.failureReason}` : ""}</span></span><StatusBadge status={a.status} /></li>))}</ul></Card>
            <Card><CardHeader title="Invoices" /><ul className="divide-y hairline text-[14px]">{d.invoices.length === 0 && <li className="px-5 py-3 text-muted">None.</li>}{d.invoices.map((i: Any) => (<li key={i.id}><Link href={`/admin/invoices/${i.id}`} className="flex justify-between px-5 py-2.5"><span>{i.number}</span><span>{money(i.totalMinor)} <StatusBadge status={i.status} /></span></Link></li>))}</ul></Card>
          </div>
        )}
      </QueryView>
    </AdminLayout>
  );
}

// ================================================================ invoices
export function AdminInvoices() {
  const params = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState("");
  const [overdue, setOverdue] = useState(params.get("overdue") === "true");
  const [createOpen, setCreateOpen] = useState(false);
  const [, navigate] = useLocation();
  const { can } = useAuth();
  const qs = new URLSearchParams({ ...(status && { status }), ...(overdue && { overdue: "true" }) }).toString();
  const list = useCursorList<Any>(["admin", "invoices", qs], `/admin/invoices?${qs}`);
  return (
    <AdminLayout title="Invoices" actions={can("invoices.manage") && <Btn size="sm" onClick={() => setCreateOpen(true)}>New invoice</Btn>}>
      <FilterBar>
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={["issued", "partially_paid", "paid", "void", "refunded", "partially_refunded"].map((s) => ({ value: s, label: humanize(s) }))} />
        <label className="flex items-center gap-2 text-[14px] pb-3"><input type="checkbox" checked={overdue} onChange={(e) => setOverdue(e.target.checked)} className="accent-[#0F1115]" /> Overdue only</label>
      </FilterBar>
      <CursorList q={list} empty={<EmptyState title="No invoices" />}>
        {(items) => (
          <Table head={["Invoice", "Client", "Kind", "Total", "Balance", "Due", "Status"]}>
            {items.map((i) => (
              <tr key={i.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/invoices/${i.id}`} className="font-medium hover:underline">{i.number}</Link></Td>
                <Td>{i.client}</Td>
                <Td>{humanize(i.kind)}</Td>
                <Td>{money(i.totalMinor)}</Td>
                <Td>{money(i.balanceMinor)}</Td>
                <Td className={i.overdue ? "text-[#9F1D1D]" : ""}>{date(i.dueAt)}</Td>
                <Td><StatusBadge status={i.overdue ? "overdue" : i.status} /></Td>
              </tr>
            ))}
          </Table>
        )}
      </CursorList>
      <NewInvoiceModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/admin/invoices/${id}`)} />
    </AdminLayout>
  );
}

function NewInvoiceModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const [search, setSearch] = useState("");
  const orgs = useQuery({ queryKey: ["admin", "orgs", search], queryFn: () => get<Any[]>(`/admin/organizations?q=${encodeURIComponent(search)}`), enabled: open });
  const [f, setF] = useState({ organizationId: "", kind: "retainer", description: "", quantity: 1, unitRand: "", dueInDays: 7, notes: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Issue an invoice" description="Amounts are excluding tax; tax is applied per settings." wide>
      <div className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <TextField label="Find client" value={search} onChange={(e) => setSearch(e.target.value)} />
          <SelectField label="Client" value={f.organizationId} onChange={(e) => setF({ ...f, organizationId: e.target.value })} placeholder="Choose…" options={(orgs.data ?? []).map((o) => ({ value: o.id, label: o.name }))} />
          <SelectField label="Kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={["retainer", "milestone", "balance", "full", "other"].map((k) => ({ value: k, label: humanize(k) }))} />
          <TextField label="Due in (days)" type="number" value={f.dueInDays} onChange={(e) => setF({ ...f, dueInDays: Number(e.target.value) })} />
        </div>
        <div className="grid grid-cols-[1fr_80px_140px] gap-3">
          <TextField label="Description" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          <TextField label="Qty" type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: Number(e.target.value) })} />
          <TextField label="Unit (R)" value={f.unitRand} onChange={(e) => setF({ ...f, unitRand: e.target.value })} />
        </div>
        <TextArea label="Notes" rows={2} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="flex justify-end"><Btn disabled={!f.organizationId || !f.description || randToMinor(f.unitRand) === null} onClick={async () => { try { const r = await post<Any>("/admin/invoices", { organizationId: f.organizationId, kind: f.kind, lines: [{ description: f.description, quantity: f.quantity, unitMinor: randToMinor(f.unitRand) }], dueInDays: f.dueInDays, notes: f.notes }); onOpenChange(false); onCreated(r.id); } catch (e) { setErr(errorMessage(e)); } }}>Issue invoice</Btn></div>
      </div>
    </Modal>
  );
}

export function AdminInvoice({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["admin", "invoice", params.id], queryFn: () => get<Any>(`/admin/invoices/${params.id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "invoice", params.id] });
  const [eftOpen, setEftOpen] = useState(false);
  const [eft, setEft] = useState({ amountRand: "", bankReference: "", receivedAt: new Date().toISOString().slice(0, 10), note: "" });
  const [refundFor, setRefundFor] = useState<Any | null>(null);
  const [refund, setRefund] = useState({ amountRand: "", reason: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <AdminLayout
      title={q.data ? `Invoice ${q.data.invoice.number}` : "Invoice"}
      back={{ href: "/admin/invoices", label: "Invoices" }}
      actions={
        q.data && (
          <>
            <Btn size="sm" variant="secondary" onClick={() => downloadFile(`/admin/invoices/${params.id}/pdf`, `${q.data.invoice.number}.pdf`)}><Download size={14} /> PDF</Btn>
            {can("payments.confirm_offline") && ["issued", "partially_paid"].includes(q.data.invoice.status) && <Btn size="sm" onClick={() => { setErr(null); setEft({ ...eft, amountRand: String(q.data.invoice.balanceMinor / 100) }); setEftOpen(true); }}>Record EFT payment</Btn>}
            {can("invoices.manage") && q.data.invoice.amountPaidMinor === 0 && ["issued", "draft"].includes(q.data.invoice.status) && <ConfirmButton title="Void this invoice?" requireReason="Reason" danger confirmLabel="Void invoice" onConfirm={async (reason) => { await post(`/admin/invoices/${params.id}/void`, { reason }); refresh(); }}>Void</ConfirmButton>}
          </>
        )
      }
    >
      <QueryView query={q}>
        {(d) => {
          const i = d.invoice;
          const pendingEft = d.attempts.filter((a: Any) => a.provider === "eft" && ["created", "pending_verification"].includes(a.status));
          return (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
              <div className="space-y-6 min-w-0">
                {err && <Alert tone="danger">{err}</Alert>}
                {pendingEft.map((a: Any) => (
                  <Alert key={a.id} tone="warning" title={`EFT ${a.status === "pending_verification" ? "proof uploaded" : "selected"}: ${a.reference}`}>
                    Expected {money(a.amountMinor, { decimals: true })}. Confirm only once the funds show on the bank statement.
                    {can("payments.confirm_offline") && <span className="block mt-2"><Btn size="sm" onClick={async () => { const ref = window.prompt("Bank statement reference for this deposit:"); if (!ref) return; try { await post("/admin/payments/offline", { attemptId: a.id, amountMinor: a.amountMinor, bankReference: ref, receivedAt: new Date().toISOString() }); refresh(); } catch (e) { setErr(errorMessage(e)); } }}>Confirm funds received</Btn>{a.proofFileId && <Btn size="sm" variant="ghost" onClick={() => openFile(a.proofFileId)}>View proof</Btn>}</span>}
                  </Alert>
                ))}
                <Card>
                  <Table head={["Description", "Qty", "Amount"]} minWidth={420}>
                    {i.lines.map((l: Any, idx: number) => (<tr key={idx}><Td>{l.description}</Td><Td>{l.quantity}</Td><Td className="text-right">{money(l.totalMinor, { decimals: true })}</Td></tr>))}
                  </Table>
                </Card>
                <Card>
                  <CardHeader title="Verified payments" />
                  <ul className="divide-y hairline text-[13px]">
                    {d.transactions.length === 0 && <li className="px-5 py-3 text-muted">None.</li>}
                    {d.transactions.map((t: Any) => (
                      <li key={t.id} className="px-5 py-3 flex flex-wrap justify-between gap-2">
                        <span>{t.provider} · {t.providerTransactionId}<span className="block text-muted">{humanize(t.verificationMethod)} · {dateTime(t.verifiedAt)}{t.feeMinor ? ` · fee ${money(t.feeMinor, { decimals: true })}` : ""}</span></span>
                        <span className="text-right">{money(t.amountMinor, { decimals: true })}{t.refundedMinor > 0 && <span className="block text-muted">refunded {money(t.refundedMinor, { decimals: true })}</span>}{can("payments.refund") && t.amountMinor > t.refundedMinor && <Btn size="sm" variant="ghost" onClick={() => { setErr(null); setRefund({ amountRand: String((t.amountMinor - t.refundedMinor) / 100), reason: "" }); setRefundFor(t); }}>Refund</Btn>}</span>
                      </li>
                    ))}
                  </ul>
                </Card>
                {(d.refunds.length > 0 || d.creditNotes.length > 0) && (
                  <Card>
                    <CardHeader title="Refunds & credit notes" />
                    <ul className="divide-y hairline text-[13px]">
                      {d.refunds.map((r: Any) => (<li key={r.id} className="px-5 py-3 flex justify-between gap-2"><span>{money(r.amountMinor, { decimals: true })} — {r.reason}<span className="block text-muted">{dateTime(r.createdAt)}</span></span><span className="flex items-center gap-2"><StatusBadge status={r.status} />{r.status === "manual_pending" && can("payments.refund") && <Btn size="sm" variant="secondary" onClick={async () => { const ref = window.prompt("Payout reference (EFT to client):"); if (!ref) return; try { await post(`/admin/refunds/${r.id}/complete`, { payoutReference: ref }); refresh(); } catch (e) { setErr(errorMessage(e)); } }}>Mark paid out</Btn>}</span></li>))}
                      {d.creditNotes.map((c: Any) => (<li key={c.id} className="px-5 py-3 flex justify-between"><span>Credit note {c.number} — {c.reason}</span><span>{money(c.amountMinor, { decimals: true })}</span></li>))}
                    </ul>
                  </Card>
                )}
              </div>
              <Card className="p-5">
                <DefinitionList items={[["Status", <StatusBadge key="s" status={i.overdue ? "overdue" : i.status} />], ["Client", d.organization?.name], ["Kind", humanize(i.kind)], ["Issued", date(i.issuedAt)], ["Due", date(i.dueAt)], ["Subtotal", money(i.subtotalMinor, { decimals: true })], [i.taxSnapshot.label, i.taxSnapshot.enabled ? money(i.taxMinor, { decimals: true }) : "Not applied"], ["Total", money(i.totalMinor, { decimals: true })], ["Paid", money(i.amountPaidMinor, { decimals: true })], ["Balance", money(i.balanceMinor, { decimals: true })], ...(i.voidReason ? [["Void reason", i.voidReason] as [string, string]] : [])]} />
              </Card>
              <Modal open={eftOpen} onOpenChange={setEftOpen} title="Record an EFT payment" description="Only record funds that have cleared in the bank account. This is audited." footer={<Btn size="sm" onClick={async () => { try { await post("/admin/payments/offline", { invoiceId: params.id, amountMinor: randToMinor(eft.amountRand), bankReference: eft.bankReference, receivedAt: new Date(eft.receivedAt).toISOString(), note: eft.note }); setEftOpen(false); refresh(); } catch (e) { setErr(errorMessage(e)); setEftOpen(false); } }}>Record payment</Btn>}>
                <div className="space-y-3">
                  <TextField label="Amount received (R)" value={eft.amountRand} onChange={(e) => setEft({ ...eft, amountRand: e.target.value })} />
                  <TextField label="Bank statement reference" value={eft.bankReference} onChange={(e) => setEft({ ...eft, bankReference: e.target.value })} />
                  <TextField label="Date received" type="date" value={eft.receivedAt} onChange={(e) => setEft({ ...eft, receivedAt: e.target.value })} />
                  <TextArea label="Note" rows={2} value={eft.note} onChange={(e) => setEft({ ...eft, note: e.target.value })} />
                </div>
              </Modal>
              <Modal open={Boolean(refundFor)} onOpenChange={(v) => !v && setRefundFor(null)} title="Refund payment" description={refundFor && `Original transaction ${refundFor.providerTransactionId} (${refundFor.provider}). Providers without a refund API are recorded as manual and must be paid out by EFT.`} footer={<Btn size="sm" variant="danger" disabled={refund.reason.trim().length < 5} onClick={async () => { try { await post(`/admin/payments/${refundFor.id}/refunds`, { amountMinor: randToMinor(refund.amountRand), reason: refund.reason, idempotencyKey: newIdempotencyKey("refund") }); setRefundFor(null); refresh(); } catch (e) { setErr(errorMessage(e)); setRefundFor(null); } }}>Issue refund</Btn>}>
                <div className="space-y-3">
                  <TextField label="Amount (R)" value={refund.amountRand} onChange={(e) => setRefund({ ...refund, amountRand: e.target.value })} />
                  <TextArea label="Reason (required)" rows={3} value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} />
                </div>
              </Modal>
            </div>
          );
        }}
      </QueryView>
    </AdminLayout>
  );
}

// ================================================================ payments
export function AdminPayments() {
  const params = new URLSearchParams(window.location.search);
  const [tab, setTab] = useState<"transactions" | "attempts" | "refunds" | "webhooks">((params.get("tab") as "attempts") ?? "transactions");
  const tx = useCursorList<Any>(["admin", "payments"], "/admin/payments");
  const attempts = useCursorList<Any>(["admin", "attempts", tab], `/admin/payment-attempts${tab === "attempts" ? "?status=pending_verification" : ""}`);
  const webhooks = useCursorList<Any>(["admin", "webhooks"], "/admin/webhook-events");
  const refunds = useQuery({ queryKey: ["admin", "refunds"], queryFn: () => get<Any[]>("/admin/refunds"), enabled: tab === "refunds" });
  return (
    <AdminLayout title="Payments & reconciliation" description="Only provider-verified (or finance-confirmed EFT) payments appear as transactions.">
      <Tabs value={tab} onChange={(v) => setTab(v as typeof tab)} tabs={[{ key: "transactions", label: "Transactions" }, { key: "attempts", label: "EFT to verify" }, { key: "refunds", label: "Refunds" }, { key: "webhooks", label: "Webhook log" }]} />
      {tab === "transactions" && (
        <CursorList q={tx} empty={<EmptyState title="No payments yet" />}>
          {(items) => (
            <Table head={["Verified", "Client", "Provider", "Reference", "Invoice", "Amount", "Refunded"]}>
              {items.map((t) => (<tr key={t.id}><Td>{dateTime(t.verifiedAt)}</Td><Td>{t.client}</Td><Td>{t.provider}<span className="block text-[12px] text-muted">{humanize(t.verificationMethod)}</span></Td><Td className="break-all">{t.providerTransactionId}</Td><Td>{t.invoiceId ? <Link href={`/admin/invoices/${t.invoiceId}`} className="underline">{t.invoiceNumber}</Link> : "—"}</Td><Td>{money(t.amountMinor, { decimals: true })}</Td><Td>{t.refundedMinor ? money(t.refundedMinor, { decimals: true }) : "—"}</Td></tr>))}
            </Table>
          )}
        </CursorList>
      )}
      {tab === "attempts" && (
        <CursorList q={attempts} empty={<EmptyState title="No EFT payments waiting for verification" />}>
          {(items) => (
            <Table head={["Reference", "Client", "Amount", "Created", "Proof", ""]}>
              {items.map((a) => (<tr key={a.id}><Td>{a.reference}</Td><Td>{a.client}</Td><Td>{money(a.amountMinor, { decimals: true })}</Td><Td>{dateTime(a.createdAt)}</Td><Td>{a.proofFileId ? <Btn size="sm" variant="ghost" onClick={() => openFile(a.proofFileId)}>View</Btn> : "—"}</Td><Td>{a.invoiceId ? <Link href={`/admin/invoices/${a.invoiceId}`} className="underline">Open invoice</Link> : a.orderId ? <Link href={`/admin/orders/${a.orderId}`} className="underline">Open order</Link> : null}</Td></tr>))}
            </Table>
          )}
        </CursorList>
      )}
      {tab === "refunds" && (
        <QueryView query={refunds} empty={<EmptyState title="No refunds" />}>
          {(list) => (
            <Table head={["Requested", "Amount", "Reason", "By", "Status"]}>
              {list.map((r) => (<tr key={r.id}><Td>{dateTime(r.createdAt)}</Td><Td>{money(r.amountMinor, { decimals: true })}</Td><Td>{r.reason}</Td><Td>{r.requestedBy}</Td><Td><StatusBadge status={r.status} />{r.invoiceId && <Link href={`/admin/invoices/${r.invoiceId}`} className="block text-[12px] underline mt-1">Invoice</Link>}</Td></tr>))}
            </Table>
          )}
        </QueryView>
      )}
      {tab === "webhooks" && (
        <CursorList q={webhooks} empty={<EmptyState title="No webhook events" />}>
          {(items) => (
            <Table head={["Received", "Provider", "Event", "Reference", "Signature", "Result", "Retries"]}>
              {items.map((w) => (<tr key={w.id}><Td>{dateTime(w.receivedAt)}</Td><Td>{w.provider}</Td><Td>{w.eventType}</Td><Td>{w.providerReference ?? "—"}</Td><Td>{w.signatureValid ? <Badge tone="success">valid</Badge> : <Badge tone="danger">invalid</Badge>}</Td><Td><StatusBadge status={w.processingStatus} /><span className="block text-[12px] text-muted max-w-[260px]">{w.result ?? w.error}</span></Td><Td>{w.retryCount}</Td></tr>))}
            </Table>
          )}
        </CursorList>
      )}
    </AdminLayout>
  );
}
