import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@workspace/domain";
import { AdminLayout, CursorList, FilterBar, Table, Td, useCursorList } from "./AdminLayout";
import { get, patch, post, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money, moneyRange, relative, humanize } from "@/lib/format";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, DefinitionList, SelectField, Stat, StatusBadge, TextArea, TextField } from "@/components/ui-kit";
import { Modal } from "@/components/ui-kit/overlay";
import { EstimateSummary } from "@/pages/Estimate";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function useStaff() {
  return useQuery({ queryKey: ["admin", "staff"], queryFn: () => get<{ id: string; name: string; role: string }[]>("/admin/staff"), staleTime: 5 * 60_000 });
}

// ---------------------------------------------------------------- dashboard
export function AdminDashboard() {
  const q = useQuery({ queryKey: ["admin", "dashboard"], queryFn: () => get<Any>("/admin/dashboard"), refetchInterval: 60_000 });
  return (
    <AdminLayout title="Dashboard">
      <QueryView query={q}>
        {(d) => {
          const open = ["new", "contacted", "qualified", "discovery_proposed", "proposal_sent"].reduce((s, k) => s + (d.leads.byStatus[k] ?? 0), 0);
          const activeProjects = Object.values(d.projects as Record<string, number>).reduce((a, b) => a + b, 0);
          return (
            <div className="space-y-6">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat label="New leads (30 days)" value={d.leads.new30d} hint={`${open} open in pipeline`} href="/admin/leads" />
                <Stat label="Qualified pipeline" value={money(d.pipeline.qualifiedValueHighMinor)} hint={`${d.pipeline.count} briefs (upper estimates)`} href="/admin/leads?status=qualified" />
                <Stat label="Outstanding invoices" value={money(d.invoices.outstandingMinor)} hint={d.invoices.overdueCount ? `${d.invoices.overdueCount} overdue · ${money(d.invoices.overdueMinor)}` : "None overdue"} href="/admin/invoices?overdue=true" />
                <Stat label="Collected (30 days)" value={money(d.revenue30dMinor)} hint="Verified payments less refunds" href="/admin/payments" />
              </div>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Stat label="Briefs needing review" value={d.reviewQueue} href="/admin/submissions?review=true" />
                <Stat label="EFTs to verify" value={d.eftPending} href="/admin/payments?tab=attempts" />
                <Stat label="Active projects" value={activeProjects} hint={d.projects.awaiting_deposit ? `${d.projects.awaiting_deposit} awaiting deposit` : undefined} href="/admin/projects" />
                <Stat label="Open requests" value={d.openRequests} href="/admin/requests" />
              </div>
              <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                <Card>
                  <CardHeader title="Proposals awaiting response" />
                  <ul className="divide-y hairline text-[14px]">
                    {d.proposalsAwaiting.length === 0 && <li className="px-5 py-4 text-muted">None.</li>}
                    {d.proposalsAwaiting.map((p: Any) => (
                      <li key={p.id}><Link href={`/admin/proposals/${p.id}`} className="flex justify-between gap-3 px-5 py-3 hover:bg-ink/[0.02]"><span>{p.reference} · {p.title}<span className="block text-[12px] text-muted">Sent {relative(p.sentAt)} · expires {date(p.expiresAt)}</span></span><span className="text-right">{money(p.totalMinor)}<span className="block"><StatusBadge status={p.status} /></span></span></Link></li>
                    ))}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Unpaid orders" />
                  <ul className="divide-y hairline text-[14px]">
                    {d.unpaidOrders.length === 0 && <li className="px-5 py-4 text-muted">None.</li>}
                    {d.unpaidOrders.map((o: Any) => (
                      <li key={o.id}><Link href={`/admin/orders/${o.id}`} className="flex justify-between gap-3 px-5 py-3 hover:bg-ink/[0.02]"><span>{o.reference}<span className="block text-[12px] text-muted">{relative(o.createdAt)}</span></span><span>{money(o.totalMinor)}</span></Link></li>
                    ))}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="Follow-ups due" />
                  <ul className="divide-y hairline text-[14px]">
                    {d.leads.followUpsDue.length === 0 && <li className="px-5 py-4 text-muted">You're up to date.</li>}
                    {d.leads.followUpsDue.map((l: Any) => (
                      <li key={l.id}><Link href={`/admin/leads/${l.id}`} className="flex justify-between px-5 py-3 hover:bg-ink/[0.02]"><span>{l.contactName}</span><span className="text-[#9F1D1D] text-[13px]">{relative(l.nextFollowUpAt)}</span></Link></li>
                    ))}
                  </ul>
                </Card>
                <Card>
                  <CardHeader title="My tasks (next 7 days)" />
                  <ul className="divide-y hairline text-[14px]">
                    {d.myTasks.length === 0 && <li className="px-5 py-4 text-muted">No tasks due.</li>}
                    {d.myTasks.map((t: Any) => (
                      <li key={t.id} className="flex justify-between gap-3 px-5 py-3"><span>{t.title}</span><span className="text-[12px] text-muted">{date(t.dueAt)}</span></li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
          );
        }}
      </QueryView>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------- leads
export function AdminLeads() {
  const [, navigate] = useLocation();
  const params = new URLSearchParams(window.location.search);
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [owner, setOwner] = useState("");
  const [q, setQ] = useState("");
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const staff = useStaff();
  const qs = new URLSearchParams({ ...(status && { status }), ...(owner && { ownerId: owner }), ...(search && { q: search }) }).toString();
  const list = useCursorList<Any>(["admin", "leads", qs], `/admin/leads?${qs}`);
  return (
    <AdminLayout title="Leads" actions={<Btn size="sm" onClick={() => setCreateOpen(true)}>New lead</Btn>}>
      <FilterBar>
        <form onSubmit={(e) => { e.preventDefault(); setSearch(q); }} className="flex gap-2"><TextField label="Search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, email, company, ref" /><Btn type="submit" size="sm" variant="secondary" className="self-end">Search</Btn></form>
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All statuses" options={LEAD_STATUSES.map((s) => ({ value: s, label: LEAD_STATUS_LABELS[s] }))} />
        <SelectField label="Owner" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Anyone" options={[{ value: "me", label: "Me" }, { value: "unassigned", label: "Unassigned" }, ...(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))]} />
      </FilterBar>
      <CursorList q={list} empty={<EmptyState title="No leads match" />}>
        {(items) => (
          <Table head={["Lead", "Company", "Source", "Status", "Owner", "Follow-up", "Created"]}>
            {items.map((l) => (
              <tr key={l.id} className="hover:bg-ink/[0.02] cursor-pointer" onClick={() => navigate(`/admin/leads/${l.id}`)}>
                <Td><Link href={`/admin/leads/${l.id}`} className="text-ink font-medium hover:underline">{l.contactName}</Link><span className="block text-[12px] text-muted">{l.reference} · {l.email}</span>{l.possibleDuplicateOfId && <Badge tone="warning" className="mt-1">Possible duplicate</Badge>}</Td>
                <Td>{l.companyName ?? "—"}</Td>
                <Td>{humanize(l.source)}</Td>
                <Td><StatusBadge status={l.status} label={LEAD_STATUS_LABELS[l.status as keyof typeof LEAD_STATUS_LABELS]} /></Td>
                <Td>{l.ownerName ?? <span className="text-faint">Unassigned</span>}</Td>
                <Td className={l.nextFollowUpAt && new Date(l.nextFollowUpAt) < new Date() ? "text-[#9F1D1D]" : ""}>{date(l.nextFollowUpAt)}</Td>
                <Td>{date(l.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </CursorList>
      <CreateLeadModal open={createOpen} onOpenChange={setCreateOpen} onCreated={(id) => navigate(`/admin/leads/${id}`)} />
    </AdminLayout>
  );
}

function CreateLeadModal({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const [f, setF] = useState({ contactName: "", email: "", phone: "", companyName: "", interest: "", summary: "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New lead">
      <form className="space-y-4" onSubmit={async (e) => { e.preventDefault(); try { const r = await post<{ id: string }>("/admin/leads", { ...f, phone: f.phone || undefined, companyName: f.companyName || undefined, interest: f.interest || undefined }); onOpenChange(false); onCreated(r.id); } catch (x) { setErr(errorMessage(x)); } }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Name" required value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} />
          <TextField label="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <TextField label="Phone" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <TextField label="Company" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
        </div>
        <TextField label="Interest" value={f.interest} onChange={(e) => setF({ ...f, interest: e.target.value })} />
        <TextArea label="Summary" value={f.summary} onChange={(e) => setF({ ...f, summary: e.target.value })} />
        {err && <Alert tone="danger">{err}</Alert>}
        <div className="flex justify-end"><Btn type="submit">Create lead</Btn></div>
      </form>
    </Modal>
  );
}

export function AdminLead({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { can } = useAuth();
  const staff = useStaff();
  const q = useQuery({ queryKey: ["admin", "lead", params.id], queryFn: () => get<Any>(`/admin/leads/${params.id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "lead", params.id] });
  const [activity, setActivity] = useState({ type: "note", body: "" });
  const [task, setTask] = useState({ title: "", dueAt: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [lostOpen, setLostOpen] = useState(false);
  const [lostReason, setLostReason] = useState("");
  const update = async (body: Record<string, unknown>) => {
    setMsg(null);
    try {
      await patch(`/admin/leads/${params.id}`, body);
      refresh();
    } catch (e) {
      setMsg(errorMessage(e));
    }
  };
  return (
    <AdminLayout title={q.data?.lead.contactName ?? "Lead"} back={{ href: "/admin/leads", label: "Leads" }} actions={can("proposals.manage") && q.data && <Btn size="sm" onClick={async () => { const r = await post<{ id: string }>("/admin/proposals", { leadId: params.id, title: `Proposal for ${q.data.lead.companyName ?? q.data.lead.contactName}`, lineItems: [{ description: "Scope to be defined", quantity: 1, unitMinor: 0 }], milestones: [{ key: "deposit", title: "Deposit on acceptance", percentBps: 5000 }, { key: "completion", title: "Completion", percentBps: 5000 }] }); navigate(`/admin/proposals/${r.id}`); }}>New proposal</Btn>}>
      <QueryView query={q}>
        {(d) => (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_380px] gap-6 items-start">
            <div className="space-y-6 min-w-0">
              {msg && <Alert tone="danger">{msg}</Alert>}
              {d.possibleDuplicate && <Alert tone="warning" title="Possible duplicate">Same email as <Link href={`/admin/leads/${d.possibleDuplicate.id}`} className="underline">{d.possibleDuplicate.reference} ({d.possibleDuplicate.companyName ?? d.possibleDuplicate.contactName})</Link> but a different company. Not merged automatically. <Btn variant="link" onClick={() => update({ possibleDuplicateOfId: null })}>Dismiss</Btn></Alert>}
              <Card>
                <CardHeader title="Log activity" />
                <form className="p-5 space-y-3" onSubmit={async (e) => { e.preventDefault(); await post(`/admin/leads/${params.id}/activities`, activity); setActivity({ type: "note", body: "" }); refresh(); }}>
                  <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-3">
                    <SelectField label="Type" value={activity.type} onChange={(e) => setActivity({ ...activity, type: e.target.value })} options={[{ value: "note", label: "Note" }, { value: "call", label: "Call" }, { value: "meeting", label: "Meeting" }, { value: "email", label: "Email" }]} />
                    <TextArea label="Details" rows={2} value={activity.body} onChange={(e) => setActivity({ ...activity, body: e.target.value })} />
                  </div>
                  <Btn type="submit" size="sm" disabled={!activity.body.trim()}>Add to timeline</Btn>
                </form>
              </Card>
              <Card>
                <CardHeader title="Activity" />
                <ol className="divide-y hairline">
                  {d.activities.map((a: Any) => (
                    <li key={a.id} className="px-5 py-3.5 text-[14px]">
                      <div className="flex flex-wrap items-center gap-2 text-[12px] text-muted"><Badge>{humanize(a.type)}</Badge><span>{a.actorName ?? "System"}</span><span>{dateTime(a.occurredAt)}</span></div>
                      <p className="text-ink mt-1.5 whitespace-pre-line">{a.body}</p>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
            <div className="space-y-6">
              <Card className="p-5 space-y-4">
                <DefinitionList items={[["Reference", d.lead.reference], ["Email", <a key="e" href={`mailto:${d.lead.email}`} className="underline">{d.lead.email}</a>], ["Phone", d.lead.phone ?? "—"], ["Company", d.lead.companyName ?? "—"], ["Role", d.lead.jobTitle ?? "—"], ["Source", humanize(d.lead.source)], ["Interest", d.lead.interest ?? "—"], ["Budget", d.lead.budgetBand ?? "—"], ["Timeline", d.lead.timeline ?? "—"], ["Marketing consent", d.lead.consentMarketing ? "Yes" : "No"], ["Created", dateTime(d.lead.createdAt)]]} />
                {Object.keys(d.lead.attribution ?? {}).length > 0 && <p className="text-[12px] text-muted">Attribution: {Object.entries(d.lead.attribution).map(([k, v]) => `${k}=${v}`).join(", ")}</p>}
                {d.lead.summary && <p className="text-[14px] text-muted whitespace-pre-line border-t hairline pt-3">{d.lead.summary}</p>}
              </Card>
              <Card className="p-5 space-y-4">
                <SelectField label="Status" value={d.lead.status} onChange={(e) => (e.target.value === "lost" ? setLostOpen(true) : update({ status: e.target.value }))} options={[{ value: d.lead.status, label: LEAD_STATUS_LABELS[d.lead.status as keyof typeof LEAD_STATUS_LABELS] }, ...d.statusOptions.filter((s: Any) => s.key !== d.lead.status).map((s: Any) => ({ value: s.key, label: s.label }))]} />
                {d.lead.status === "lost" && d.lead.lostReason && <p className="text-[13px] text-muted">Lost: {d.lead.lostReason}</p>}
                <SelectField label="Owner" value={d.lead.ownerId ?? ""} onChange={(e) => update({ ownerId: e.target.value || null })} placeholder="Unassigned" options={(staff.data ?? []).map((s) => ({ value: s.id, label: s.name }))} disabled={!can("leads.assign")} hint={!can("leads.assign") ? "Only admins can reassign." : undefined} />
                <TextField label="Next follow-up" type="datetime-local" defaultValue={d.lead.nextFollowUpAt ? new Date(d.lead.nextFollowUpAt).toISOString().slice(0, 16) : ""} onBlur={(e) => update({ nextFollowUpAt: e.target.value ? new Date(e.target.value).toISOString() : null })} />
              </Card>
              <Card>
                <CardHeader title="Tasks" />
                <ul className="divide-y hairline text-[14px]">
                  {d.tasks.map((t: Any) => (
                    <li key={t.id} className="px-5 py-2.5 flex items-center gap-3">
                      <input type="checkbox" checked={Boolean(t.completedAt)} onChange={async (e) => { await patch(`/admin/tasks/${t.id}`, { completed: e.target.checked }); refresh(); }} aria-label={`Complete ${t.title}`} className="accent-[#0F1115]" />
                      <span className={t.completedAt ? "line-through text-muted" : ""}>{t.title}</span>
                      <span className="ml-auto text-[12px] text-muted">{date(t.dueAt)}</span>
                    </li>
                  ))}
                </ul>
                <form className="p-5 border-t hairline grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end" onSubmit={async (e) => { e.preventDefault(); await post("/admin/tasks", { title: task.title, leadId: params.id, dueAt: task.dueAt ? new Date(task.dueAt).toISOString() : null }); setTask({ title: "", dueAt: "" }); refresh(); }}>
                  <TextField label="New task" value={task.title} onChange={(e) => setTask({ ...task, title: e.target.value })} />
                  <TextField label="Due" type="date" value={task.dueAt} onChange={(e) => setTask({ ...task, dueAt: e.target.value })} />
                  <Btn type="submit" size="sm" disabled={!task.title} className="sm:col-span-2">Add task</Btn>
                </form>
              </Card>
              <Card>
                <CardHeader title="Briefs & proposals" />
                <ul className="divide-y hairline text-[14px]">
                  {d.submissions.map((s: Any) => (<li key={s.id}><Link href={`/admin/submissions/${s.id}`} className="flex justify-between px-5 py-2.5 hover:bg-ink/[0.02]"><span>Brief {s.reference}</span><StatusBadge status={s.status} /></Link></li>))}
                  {d.proposals.map((p: Any) => (<li key={p.id}><Link href={`/admin/proposals/${p.id}`} className="flex justify-between px-5 py-2.5 hover:bg-ink/[0.02]"><span>{p.reference} v{p.version} · {money(p.totalMinor)}</span><StatusBadge status={p.status} /></Link></li>))}
                  {!d.submissions.length && !d.proposals.length && <li className="px-5 py-3 text-muted">None yet.</li>}
                </ul>
              </Card>
            </div>
            <Modal open={lostOpen} onOpenChange={setLostOpen} title="Mark lead as lost" footer={<Btn size="sm" disabled={lostReason.trim().length < 3} onClick={async () => { await update({ status: "lost", lostReason }); setLostOpen(false); }}>Mark lost</Btn>}>
              <TextArea label="Reason" value={lostReason} onChange={(e) => setLostReason(e.target.value)} />
            </Modal>
          </div>
        )}
      </QueryView>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------- configurator submissions
export function AdminSubmissions() {
  const params = new URLSearchParams(window.location.search);
  const [review, setReview] = useState(params.get("review") === "true");
  const qs = review ? "review=true" : "";
  const list = useCursorList<Any>(["admin", "submissions", qs], `/admin/submissions?${qs}`);
  return (
    <AdminLayout title="Configurator briefs" description="Every submitted brief with its server-calculated estimate and review flags.">
      <FilterBar>
        <label className="flex items-center gap-2 text-[14px]"><input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="accent-[#0F1115]" /> Needs manual review only</label>
      </FilterBar>
      <CursorList q={list} empty={<EmptyState title="No briefs yet" />}>
        {(items) => (
          <Table head={["Brief", "Client", "Solution", "Estimate", "Flags", "Status", "Submitted"]}>
            {items.map((s) => (
              <tr key={s.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/submissions/${s.id}`} className="font-medium underline-offset-4 hover:underline">{s.reference}</Link></Td>
                <Td>{s.lead.contactName}<span className="block text-[12px] text-muted">{s.lead.companyName}</span></Td>
                <Td>{s.solutionTypes.map(humanize).join(", ")}</Td>
                <Td>{s.estimate?.lowMinor ? moneyRange(s.estimate.lowMinor, s.estimate.highMinor) : <span className="text-faint">Not priced</span>}{s.estimate && <span className="block text-[12px] text-muted">{s.estimate.confidence} confidence · {humanize(s.estimate.recommendation)}</span>}</Td>
                <Td>{s.estimate?.flags?.length ? <Badge tone="warning">{s.estimate.flags.length} flag{s.estimate.flags.length > 1 ? "s" : ""}</Badge> : "—"}</Td>
                <Td><StatusBadge status={s.status} /></Td>
                <Td>{date(s.submittedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </CursorList>
    </AdminLayout>
  );
}

export function AdminSubmission({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["admin", "submission", params.id], queryFn: () => get<Any>(`/admin/submissions/${params.id}`) });
  const [notes, setNotes] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "submission", params.id] });
  return (
    <AdminLayout
      title={q.data ? `Brief ${q.data.submission.reference}` : "Brief"}
      back={{ href: "/admin/submissions", label: "Briefs" }}
      actions={
        q.data && (
          <>
            <Btn size="sm" variant="secondary" onClick={async () => { try { await post(`/admin/submissions/${params.id}/re-estimate`); refresh(); } catch (e) { setErr(errorMessage(e)); } }}>Re-estimate with current rules</Btn>
            {can("proposals.manage") && <Btn size="sm" onClick={async () => { try { const r = await post<{ id: string }>("/admin/proposals/from-submission", { submissionId: params.id }); navigate(`/admin/proposals/${r.id}`); } catch (e) { setErr(errorMessage(e)); } }}>Draft proposal from brief</Btn>}
          </>
        )
      }
    >
      <QueryView query={q}>
        {(d) => (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
            <div className="min-w-0 space-y-6">
              {err && <Alert tone="danger">{err}</Alert>}
              <EstimateSummary view={d.view} showCtas={false} />
              <Card>
                <CardHeader title="Answers" />
                <pre className="p-5 text-[12px] leading-relaxed overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(d.submission.answers, null, 2)}</pre>
              </Card>
            </div>
            <div className="space-y-6">
              <Card className="p-5 space-y-4">
                <DefinitionList items={[["Lead", <Link key="l" href={`/admin/leads/${d.lead.id}`} className="underline">{d.lead.contactName}</Link>], ["Status", <StatusBadge key="s" status={d.submission.status} />], ["Submitted", dateTime(d.submission.submittedAt)], ["Estimates", d.estimates.length]]} />
                <SelectField label="Review status" value={d.submission.status} onChange={async (e) => { await patch(`/admin/submissions/${params.id}`, { status: e.target.value }); refresh(); }} options={["submitted", "under_review", "estimate_ready", "converted", "closed"].map((s) => ({ value: s, label: humanize(s) }))} />
                <TextArea label="Internal review notes" rows={4} value={notes ?? d.submission.reviewNotes} onChange={(e) => setNotes(e.target.value)} />
                <Btn size="sm" variant="secondary" disabled={notes === null} onClick={async () => { await patch(`/admin/submissions/${params.id}`, { reviewNotes: notes }); setNotes(null); refresh(); }}>Save notes</Btn>
              </Card>
              <Card>
                <CardHeader title="Estimate history" />
                <ul className="divide-y hairline text-[13px]">
                  {d.estimates.map((e: Any) => (<li key={e.id} className="px-5 py-2.5 flex justify-between gap-2"><span>{e.reference} · rules v{e.rulesVersion ?? "—"}</span><span>{e.lowMinor ? moneyRange(e.lowMinor, e.highMinor) : "—"} <StatusBadge status={e.status === "indicative" ? "active" : e.status} label={e.status} /></span></li>))}
                </ul>
              </Card>
              {d.proposals.length > 0 && (
                <Card>
                  <CardHeader title="Proposals" />
                  <ul className="divide-y hairline text-[14px]">{d.proposals.map((p: Any) => (<li key={p.id}><Link href={`/admin/proposals/${p.id}`} className="flex justify-between px-5 py-2.5"><span>{p.reference} v{p.version}</span><StatusBadge status={p.status} /></Link></li>))}</ul>
                </Card>
              )}
            </div>
          </div>
        )}
      </QueryView>
    </AdminLayout>
  );
}

// ---------------------------------------------------------------- reports
export function AdminReports() {
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ["admin", "funnel", days], queryFn: () => get<Any>(`/admin/reports/funnel?days=${days}`) });
  return (
    <AdminLayout title="Funnel report" description="Built from first-party events (client-side events only after analytics consent).">
      <FilterBar>
        <SelectField label="Period" value={String(days)} onChange={(e) => setDays(Number(e.target.value))} options={[7, 30, 90, 365].map((d) => ({ value: String(d), label: `Last ${d} days` }))} />
      </FilterBar>
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-6">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Configurator completion" value={d.conversion.configuratorCompletionPct === null ? "—" : `${d.conversion.configuratorCompletionPct}%`} />
              <Stat label="Checkout conversion" value={d.conversion.checkoutConversionPct === null ? "—" : `${d.conversion.checkoutConversionPct}%`} />
              <Stat label="Discovery conversion" value={d.conversion.discoveryConversionPct === null ? "—" : `${d.conversion.discoveryConversionPct}%`} />
              <Stat label="Proposal acceptance" value={d.conversion.proposalAcceptancePct === null ? "—" : `${d.conversion.proposalAcceptancePct}%`} />
            </div>
            <Table head={["Event", "Count"]} minWidth={360}>
              {Object.entries(d.counts as Record<string, number>).map(([k, v]) => (<tr key={k}><Td>{humanize(k)}</Td><Td>{v}</Td></tr>))}
            </Table>
          </div>
        )}
      </QueryView>
    </AdminLayout>
  );
}
