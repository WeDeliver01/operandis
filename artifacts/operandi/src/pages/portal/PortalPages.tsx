import { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Download, Upload } from "lucide-react";
import type { Me, PaymentRedirect } from "@workspace/api-zod";
import { PortalLayout } from "./PortalLayout";
import { get, patch, post, api, downloadFile, errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money, moneyRange, relative, fileSize, humanize } from "@/lib/format";
import { QueryView, EmptyState, LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, Checkbox, DefinitionList, LinkBtn, SelectField, Stat, StatusBadge, TextArea, TextField, buttonClass } from "@/components/ui-kit";
import { Modal } from "@/components/ui-kit/overlay";
import { EftInstructions, MilestoneTimeline, PaymentHandoff, ProgressBar } from "@/components/commerce";
import { EstimateSummary } from "@/pages/Estimate";
import { safeNext } from "@/pages/auth/AuthPages";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ---------------------------------------------------------------- dashboard
export function PortalDashboard() {
  const q = useQuery({ queryKey: ["portal", "dashboard"], queryFn: () => get<Any>("/portal/dashboard") });
  const { me } = useAuth();
  return (
    <PortalLayout title={`Welcome${me?.name ? `, ${me.name.split(" ")[0]}` : ""}`} actions={<LinkBtn href="/configure" variant="secondary" size="sm">New project brief</LinkBtn>}>
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-8">
            {d.actions.length > 0 && (
              <Card>
                <CardHeader title="Needs your attention" />
                <ul className="divide-y hairline">
                  {d.actions.map((a: Any) => (
                    <li key={a.href + a.title}>
                      <Link href={a.href} className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-ink/[0.02]">
                        <span className="flex items-center gap-3 text-[15px] text-ink">
                          {a.kind === "overdue_invoice" ? <Badge tone="danger">Overdue</Badge> : a.kind === "proposal" ? <Badge tone="info">Proposal</Badge> : a.kind === "approval" ? <Badge tone="warning">Approval</Badge> : <Badge>Invoice</Badge>}
                          {a.title}
                        </span>
                        <ArrowRight size={14} className="text-muted shrink-0" />
                      </Link>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Stat label="Outstanding balance" value={money(d.finance.outstandingMinor)} hint={d.finance.overdueCount ? `${d.finance.overdueCount} overdue` : "Nothing overdue"} href="/portal/invoices" />
              <Stat label="Next payment" value={d.finance.nextPayment ? money(d.finance.nextPayment.amountMinor) : "—"} hint={d.finance.nextPayment ? `Due ${date(d.finance.nextPayment.dueAt)}` : "No payment due"} href={d.finance.nextPayment ? `/portal/invoices/${d.finance.nextPayment.invoiceId}` : undefined} />
              <Stat label="Active projects" value={d.projects.filter((p: Any) => !["completed", "cancelled"].includes(p.status)).length} href="/portal/projects" />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <Card>
                <CardHeader title="Projects" actions={<Link href="/portal/projects" className="text-[13px] underline">All</Link>} />
                {d.projects.length === 0 ? (
                  <EmptyState title="No projects yet" action={<div className="flex gap-2"><LinkBtn href="/packages" size="sm" variant="secondary">Browse packages</LinkBtn><LinkBtn href="/configure" size="sm">Configure a project</LinkBtn></div>}>When you buy a package or accept a proposal, your project appears here.</EmptyState>
                ) : (
                  <ul className="divide-y hairline">
                    {d.projects.map((p: Any) => (
                      <li key={p.id}>
                        <Link href={`/portal/projects/${p.id}`} className="block px-5 py-4 hover:bg-ink/[0.02]">
                          <div className="flex justify-between gap-3"><span className="text-ink font-medium">{p.name}</span><StatusBadge status={p.status} label={p.statusLabel} /></div>
                          <div className="mt-3"><ProgressBar value={p.progressPct} label={`${p.name} progress`} /></div>
                          <div className="text-[12px] text-muted mt-1.5">{p.progressPct}% · Target {date(p.targetDate)}</div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card>
                <CardHeader title="Upcoming milestones" />
                {d.upcomingMilestones.length === 0 ? (
                  <p className="px-5 py-6 text-[14px] text-muted">No upcoming milestones.</p>
                ) : (
                  <ul className="divide-y hairline">
                    {d.upcomingMilestones.map((m: Any) => (
                      <li key={m.id} className="px-5 py-3.5 flex justify-between gap-3 text-[14px]">
                        <span><span className="text-ink">{m.title}</span><span className="block text-[12px] text-muted">{m.projectName}</span></span>
                        <span className="text-right"><StatusBadge status={m.status} /><span className="block text-[12px] text-muted mt-1">{date(m.targetDate)}</span></span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </div>
            <Card>
              <CardHeader title="Recent activity" actions={<Link href="/portal/notifications" className="text-[13px] underline">All notifications</Link>} />
              {d.recent.length === 0 ? <p className="px-5 py-6 text-[14px] text-muted">Nothing yet.</p> : (
                <ul className="divide-y hairline">
                  {d.recent.map((n: Any) => (
                    <li key={n.id} className="px-5 py-3 flex justify-between gap-4 text-[14px]">
                      {n.link ? <Link href={n.link.replace(/^https?:\/\/[^/]+/, "")} className="text-ink hover:underline">{n.subject}</Link> : <span className="text-ink">{n.subject}</span>}
                      <span className="text-[12px] text-muted whitespace-nowrap">{relative(n.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

// ---------------------------------------------------------------- projects
export function PortalProjects() {
  const q = useQuery({ queryKey: ["portal", "projects"], queryFn: () => get<Any[]>("/portal/projects") });
  return (
    <PortalLayout title="Projects">
      <QueryView query={q} empty={<EmptyState title="No projects yet" action={<LinkBtn href="/packages">Browse packages</LinkBtn>}>Projects appear once you purchase a package or accept a proposal.</EmptyState>}>
        {(list) => (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {list.map((p) => (
              <Link key={p.id} href={`/portal/projects/${p.id}`} className="block bg-white border hairline rounded-sm p-5 hover:border-ink/40">
                <div className="flex justify-between gap-3"><span className="font-serif text-[19px] text-ink">{p.name}</span><StatusBadge status={p.status} label={p.statusLabel} /></div>
                <div className="text-[12px] text-muted mt-1">{p.reference}</div>
                <div className="mt-4"><ProgressBar value={p.progressPct} /></div>
                <div className="text-[12px] text-muted mt-1.5">{p.progressPct}% complete · Target {date(p.targetDate)}</div>
              </Link>
            ))}
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function FileUpload({ projectId, attemptId, onDone, label = "Upload a file" }: { projectId?: string; attemptId?: string; onDone: () => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <label className={buttonClass("secondary", "sm", "relative overflow-hidden")}>
        <Upload size={14} /> {busy ? "Uploading…" : label}
        <input
          type="file"
          className="absolute inset-0 opacity-0 cursor-pointer"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif,.zip,.docx,.xlsx,.pptx,.txt,.csv,.md"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            if (file.size > 15 * 1024 * 1024) {
              setError("Files must be 15 MB or smaller.");
              return;
            }
            const fd = new FormData();
            fd.append("file", file);
            if (projectId) fd.append("projectId", projectId);
            if (attemptId) fd.append("attemptId", attemptId);
            setBusy(true);
            setError(null);
            try {
              await api("POST", "/files", fd);
              onDone();
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {error && <p role="alert" className="text-[12px] text-[#9F1D1D] mt-2">{error}</p>}
      <p className="text-[11px] text-faint mt-1">PDF, images, Office documents, ZIP, TXT or CSV · max 15 MB</p>
    </div>
  );
}

export async function openFile(id: string) {
  const r = await get<{ url: string }>(`/files/${id}/download-url`);
  window.location.assign(r.url);
}

export function PortalProject({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal", "project", params.id], queryFn: () => get<Any>(`/portal/projects/${params.id}`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "project", params.id] });
  const [message, setMessage] = useState("");
  const [crOpen, setCrOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <PortalLayout title={q.data?.project.name ?? "Project"} back={{ href: "/portal/projects", label: "All projects" }} actions={q.data && <Btn size="sm" variant="secondary" onClick={() => setCrOpen(true)}>Raise a request</Btn>}>
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-6">
            {d.project.depositRequired && !d.project.depositPaid && d.project.depositInvoiceId && (
              <Alert tone="warning" title="Deposit due">Work starts once the deposit is paid. <Link href={`/portal/invoices/${d.project.depositInvoiceId}`} className="underline font-medium">Pay the deposit</Link></Alert>
            )}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Stat label="Status" value={<StatusBadge status={d.project.status} label={d.project.statusLabel} />} />
              <Stat label="Progress" value={`${d.project.progressPct}%`} hint={`Target ${date(d.project.targetDate)}`} />
              <Stat label="Contract value" value={money(d.finance.contractValueMinor)} hint={`Paid ${money(d.finance.paidToDateMinor)}`} />
              <Stat label="Balance" value={money(d.finance.balanceMinor)} hint={d.finance.nextPayment ? `Next: ${money(d.finance.nextPayment.amountMinor)} due ${date(d.finance.nextPayment.dueAt)}` : "Nothing due now"} href={d.finance.nextPayment ? `/portal/invoices/${d.finance.nextPayment.invoiceId}` : undefined} />
            </div>
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-6 items-start">
              <div className="space-y-6 min-w-0">
                <Card>
                  <CardHeader title="Milestones" />
                  <div className="p-5">
                    {d.milestones.length === 0 ? <p className="text-muted text-[14px]">Milestones will appear here once planned.</p> : (
                      <MilestoneTimeline
                        items={d.milestones}
                        actions={(m) =>
                          m.status === "awaiting_approval" ? (
                            <Btn size="sm" onClick={async () => { await post(`/portal/projects/${params.id}/milestones/${m.id}/approve`); refresh(); }}>Approve milestone</Btn>
                          ) : null
                        }
                      />
                    )}
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Updates & messages" />
                  <form className="p-5 border-b hairline space-y-3" onSubmit={async (e) => { e.preventDefault(); if (!message.trim()) return; setBusy(true); try { await post(`/portal/projects/${params.id}/messages`, { body: message }); setMessage(""); refresh(); } finally { setBusy(false); } }}>
                    <TextArea label="Message the team" rows={3} value={message} onChange={(e) => setMessage(e.target.value)} />
                    <Btn type="submit" size="sm" loading={busy} disabled={!message.trim()}>Send</Btn>
                  </form>
                  <ul className="divide-y hairline">
                    {d.updates.length === 0 && <li className="px-5 py-6 text-[14px] text-muted">No updates yet.</li>}
                    {d.updates.map((u: Any) => (
                      <li key={u.id} className="px-5 py-4">
                        <div className="flex items-center gap-2 text-[12px] text-muted">
                          <span className="text-ink font-medium">{u.fromStudio ? `${u.authorName ?? "Operandis"} · Operandis` : u.authorName ?? "You"}</span>
                          {u.kind === "update" && <Badge tone="info">Update</Badge>}
                          <span>{relative(u.createdAt)}</span>
                        </div>
                        <p className="text-[14px] text-ink mt-1.5 whitespace-pre-line">{u.body}</p>
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
              <div className="space-y-6">
                <Card>
                  <CardHeader title="Files & deliverables" />
                  <div className="p-5 space-y-4">
                    <FileUpload projectId={params.id} onDone={refresh} />
                    <ul className="divide-y hairline">
                      {d.files.length === 0 && <li className="py-3 text-[14px] text-muted">No files yet.</li>}
                      {d.files.map((f: Any) => (
                        <li key={f.id} className="py-3 flex items-start justify-between gap-3">
                          <span className="min-w-0">
                            <span className="block text-[14px] text-ink truncate">{f.fileName}</span>
                            <span className="text-[12px] text-muted">{humanize(f.kind)} · {fileSize(f.sizeBytes)} · {date(f.createdAt)}{f.approvedAt ? " · Approved" : ""}</span>
                          </span>
                          <span className="flex gap-1 shrink-0">
                            {f.kind === "deliverable" && !f.approvedAt && <Btn size="sm" variant="ghost" onClick={async () => { await post(`/files/${f.id}/approve`); refresh(); }}>Approve</Btn>}
                            <Btn size="sm" variant="ghost" onClick={() => openFile(f.id)} aria-label={`Download ${f.fileName}`}><Download size={14} /></Btn>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Requests" />
                  <ul className="divide-y hairline">
                    {d.changeRequests.length === 0 && <li className="px-5 py-4 text-[14px] text-muted">No requests.</li>}
                    {d.changeRequests.map((c: Any) => (
                      <li key={c.id} className="px-5 py-4 text-[14px]">
                        <div className="flex justify-between gap-2"><span className="text-ink font-medium">{c.title}</span><StatusBadge status={c.status} /></div>
                        <div className="text-[12px] text-muted mt-0.5">{c.reference} · {humanize(c.type)}</div>
                        {c.response && <p className="text-muted mt-2">{c.response}</p>}
                        {c.status === "quoted" && (
                          <div className="mt-3 space-y-2">
                            <p>Quote: <strong>{money(c.impactEstimateMinor)}</strong>{c.impactDays ? `, +${c.impactDays} days` : ""}</p>
                            <div className="flex gap-2">
                              <Btn size="sm" onClick={async () => { await post(`/portal/change-requests/${c.id}/decision`, { decision: "approve" }); refresh(); }}>Approve</Btn>
                              <Btn size="sm" variant="secondary" onClick={async () => { await post(`/portal/change-requests/${c.id}/decision`, { decision: "reject" }); refresh(); }}>Decline</Btn>
                            </div>
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                </Card>
              </div>
            </div>
            <ChangeRequestModal open={crOpen} onOpenChange={setCrOpen} projectId={params.id} onDone={refresh} />
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

function ChangeRequestModal({ open, onOpenChange, projectId, onDone }: { open: boolean; onOpenChange: (v: boolean) => void; projectId: string; onDone: () => void }) {
  const [form, setForm] = useState({ type: "change", title: "", description: "", priority: "normal" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Raise a request" description="Something broken, or something new? Defects are fixed under warranty; new scope is quoted before any work starts.">
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError(null);
          try {
            await post("/portal/change-requests", { ...form, projectId });
            onOpenChange(false);
            setForm({ type: "change", title: "", description: "", priority: "normal" });
            onDone();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <SelectField label="Type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })} options={[{ value: "defect", label: "Something isn't working (defect)" }, { value: "change", label: "A change or new feature" }, { value: "support", label: "Support / how-to" }, { value: "question", label: "A question" }]} />
        <TextField label="Short title" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <TextArea label="Details" required rows={5} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} hint={form.type === "defect" ? "What did you expect, what happened, and how can we reproduce it?" : undefined} />
        <SelectField label="Priority" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} options={[{ value: "low", label: "Low" }, { value: "normal", label: "Normal" }, { value: "high", label: "High" }, { value: "urgent", label: "Urgent — business is blocked" }]} />
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end"><Btn type="submit" loading={busy}>Submit request</Btn></div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- proposals
export function PortalProposals() {
  const q = useQuery({ queryKey: ["portal", "proposals"], queryFn: () => get<Any[]>("/portal/proposals") });
  return (
    <PortalLayout title="Proposals">
      <QueryView query={q} empty={<EmptyState title="No proposals yet">After discovery we'll send a written proposal here for you to review and accept.</EmptyState>}>
        {(list) => (
          <Card>
            <ul className="divide-y hairline">
              {list.filter((p) => p.isLatest).map((p) => (
                <li key={p.id}>
                  <Link href={`/portal/proposals/${p.id}`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-ink/[0.02]">
                    <span><span className="block text-ink font-medium">{p.title}</span><span className="text-[12px] text-muted">{p.reference} · v{p.version} · sent {date(p.sentAt)}</span></span>
                    <span className="flex items-center gap-4"><span className="font-serif text-[18px]">{money(p.totalMinor)}</span><StatusBadge status={p.status} /></span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalProposal({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["portal", "proposal", params.id], queryFn: () => get<Any>(`/portal/proposals/${params.id}`) });
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [declineOpen, setDeclineOpen] = useState(false);
  const [reason, setReason] = useState("");
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "proposal", params.id] });
  return (
    <PortalLayout title={q.data?.proposal.title ?? "Proposal"} back={{ href: "/portal/proposals", label: "All proposals" }} actions={q.data && <Btn size="sm" variant="secondary" onClick={() => downloadFile(`/portal/proposals/${params.id}/pdf`, `${q.data.proposal.reference}-v${q.data.proposal.version}.pdf`)}><Download size={14} /> PDF</Btn>}>
      <QueryView query={q}>
        {({ proposal: p, thread, versions }) => (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-8 items-start">
            <article className="space-y-8 min-w-0">
              <div className="flex flex-wrap items-center gap-3 text-[13px] text-muted">
                <StatusBadge status={p.status} />
                <span>{p.reference} · Version {p.version}</span>
                <span>Valid until {date(p.expiresAt)}</span>
                {!p.isLatest && <Badge tone="warning">A newer version exists</Badge>}
              </div>
              {p.summary && <p className="text-[17px] text-ink leading-relaxed whitespace-pre-line">{p.summary}</p>}
              {p.sections.map((s: Any) => (
                <section key={s.heading}>
                  <h2 className="font-serif text-[22px] text-ink mb-2">{s.heading}</h2>
                  <p className="text-[15px] text-muted leading-relaxed whitespace-pre-line">{s.body}</p>
                </section>
              ))}
              <section>
                <h2 className="font-serif text-[22px] text-ink mb-3">Investment</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-[14px] min-w-[480px]">
                    <thead><tr className="text-left text-[12px] uppercase tracking-wider text-faint border-b hairline"><th className="py-2 font-medium">Item</th><th className="py-2 font-medium text-right">Qty</th><th className="py-2 font-medium text-right">Amount</th></tr></thead>
                    <tbody className="divide-y hairline">
                      {p.lineItems.map((l: Any, i: number) => (<tr key={i}><td className="py-2.5 pr-4">{l.description}</td><td className="py-2.5 text-right">{l.quantity}</td><td className="py-2.5 text-right whitespace-nowrap">{money(l.totalMinor)}</td></tr>))}
                    </tbody>
                    <tfoot className="border-t hairline">
                      {p.taxMinor > 0 && <tr><td colSpan={2} className="py-2 text-right text-muted">{p.taxLabel}</td><td className="py-2 text-right">{money(p.taxMinor)}</td></tr>}
                      <tr><td colSpan={2} className="py-2 text-right font-medium">Total</td><td className="py-2 text-right font-serif text-[20px]">{money(p.totalMinor)}</td></tr>
                    </tfoot>
                  </table>
                </div>
              </section>
              <section>
                <h2 className="font-serif text-[22px] text-ink mb-3">Payment schedule</h2>
                <ul className="divide-y hairline border-y hairline text-[14px]">
                  {p.milestones.map((m: Any) => (<li key={m.key} className="flex justify-between gap-4 py-2.5"><span>{m.title}{m.isDeposit && <Badge tone="accent" className="ml-2">Deposit</Badge>}{m.description && <span className="block text-[12px] text-muted">{m.description}</span>}</span><span className="whitespace-nowrap">{money(m.amountMinor)}</span></li>))}
                </ul>
              </section>
              {p.timelineSummary && <section><h2 className="font-serif text-[22px] text-ink mb-2">Timeline</h2><p className="text-[15px] text-muted">{p.timelineSummary}</p></section>}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {p.assumptions.length > 0 && <section><h2 className="font-serif text-[20px] text-ink mb-2">Assumptions</h2><ul className="list-disc pl-5 text-[14px] text-muted space-y-1">{p.assumptions.map((a: string) => <li key={a}>{a}</li>)}</ul></section>}
                {p.exclusions.length > 0 && <section><h2 className="font-serif text-[20px] text-ink mb-2">Exclusions</h2><ul className="list-disc pl-5 text-[14px] text-muted space-y-1">{p.exclusions.map((a: string) => <li key={a}>{a}</li>)}</ul></section>}
              </div>
              {p.terms && <section><h2 className="font-serif text-[20px] text-ink mb-2">Terms</h2><p className="text-[14px] text-muted whitespace-pre-line leading-relaxed">{p.terms}</p></section>}
            </article>
            <aside className="space-y-6 xl:sticky xl:top-28">
              <Card className="p-5">
                <div className="text-[12px] uppercase tracking-wider text-faint">Total</div>
                <div className="font-serif text-[32px] text-ink">{money(p.totalMinor)}</div>
                <div className="text-[14px] text-muted">Deposit on acceptance: <strong className="text-ink font-medium">{money(p.depositMinor)}</strong></div>
                {p.status === "accepted" ? (
                  <Alert tone="success" className="mt-4" title="Accepted">Accepted on {dateTime(p.acceptedAt)}. Your deposit invoice is in <Link href="/portal/invoices" className="underline">Invoices</Link>.</Alert>
                ) : ["sent", "viewed"].includes(p.status) && p.isLatest ? (
                  <div className="mt-5 space-y-4">
                    <Checkbox checked={confirm} onChange={(e) => setConfirm(e.target.checked)} label={<>I've read version {p.version} of this proposal and accept its scope, total of {money(p.totalMinor)}, payment schedule and terms.</>} />
                    {error && <Alert tone="danger">{error}</Alert>}
                    <Btn
                      className="w-full"
                      loading={busy}
                      disabled={!confirm}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const r = await post<Any>(`/portal/proposals/${p.id}/accept`, { proposalId: p.id, contentHash: p.contentHash, confirm: true });
                          await qc.invalidateQueries({ queryKey: ["portal"] });
                          navigate(r.depositInvoiceId ? `/portal/invoices/${r.depositInvoiceId}` : `/portal/projects/${r.projectId}`);
                        } catch (err) {
                          setError(errorMessage(err));
                          refresh();
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Accept proposal
                    </Btn>
                    <Btn variant="ghost" className="w-full" onClick={() => setDeclineOpen(true)}>Decline</Btn>
                  </div>
                ) : (
                  <Alert tone="info" className="mt-4">This proposal is {p.status.replace("_", " ")}{!p.isLatest ? " — see the latest version" : ""}.</Alert>
                )}
                {versions.length > 1 && (
                  <div className="mt-5 pt-4 border-t hairline text-[13px]">
                    <div className="text-muted mb-1">Versions</div>
                    {versions.map((v: Any) => (<Link key={v.id} href={`/portal/proposals/${v.id}`} className={`block ${v.id === p.id ? "font-medium text-ink" : "text-muted underline"}`}>v{v.version} — {humanize(v.status)}</Link>))}
                  </div>
                )}
              </Card>
              <Card>
                <CardHeader title="Questions" />
                <ul className="divide-y hairline max-h-[320px] overflow-y-auto">
                  {thread.length === 0 && <li className="px-5 py-4 text-[14px] text-muted">Ask anything about this proposal.</li>}
                  {thread.map((m: Any) => (<li key={m.id} className="px-5 py-3 text-[14px]"><div className="text-[12px] text-muted">{m.fromStudio ? "Operandis" : "You"} · {relative(m.createdAt)}</div><p className="text-ink mt-1 whitespace-pre-line">{m.body}</p></li>))}
                </ul>
                <form className="p-5 border-t hairline space-y-2" onSubmit={async (e) => { e.preventDefault(); if (!question.trim()) return; await post(`/portal/proposals/${p.id}/messages`, { body: question }); setQuestion(""); refresh(); }}>
                  <TextArea label="Your question" rows={3} value={question} onChange={(e) => setQuestion(e.target.value)} />
                  <Btn type="submit" size="sm" disabled={!question.trim()}>Send</Btn>
                </form>
              </Card>
            </aside>
            <Modal open={declineOpen} onOpenChange={setDeclineOpen} title="Decline this proposal?" footer={<><Btn variant="ghost" size="sm" onClick={() => setDeclineOpen(false)}>Cancel</Btn><Btn variant="danger" size="sm" onClick={async () => { try { await post(`/portal/proposals/${p.id}/decline`, { proposalId: p.id, contentHash: p.contentHash, confirm: true, reason: reason || undefined }); setDeclineOpen(false); refresh(); } catch (e) { setError(errorMessage(e)); } }}>Decline proposal</Btn></>}>
              <TextArea label="Tell us why (optional)" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Modal>
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

// ---------------------------------------------------------------- invoices
export function PortalInvoices() {
  const q = useQuery({ queryKey: ["portal", "invoices"], queryFn: () => get<Any[]>("/portal/invoices") });
  return (
    <PortalLayout title="Invoices & payments">
      <QueryView query={q} empty={<EmptyState title="No invoices yet" />}>
        {(list) => (
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full text-[14px] min-w-[620px]">
                <thead><tr className="text-left text-[12px] uppercase tracking-wider text-faint border-b hairline"><th className="px-5 py-3 font-medium">Invoice</th><th className="px-5 py-3 font-medium">Issued</th><th className="px-5 py-3 font-medium">Due</th><th className="px-5 py-3 font-medium text-right">Total</th><th className="px-5 py-3 font-medium text-right">Balance</th><th className="px-5 py-3 font-medium">Status</th></tr></thead>
                <tbody className="divide-y hairline">
                  {list.map((i) => (
                    <tr key={i.id} className="hover:bg-ink/[0.02]">
                      <td className="px-5 py-3"><Link href={`/portal/invoices/${i.id}`} className="text-ink underline underline-offset-4">{i.number}</Link><span className="block text-[12px] text-muted">{humanize(i.kind)}</span></td>
                      <td className="px-5 py-3">{date(i.issuedAt)}</td>
                      <td className="px-5 py-3">{date(i.dueAt)}</td>
                      <td className="px-5 py-3 text-right">{money(i.totalMinor)}</td>
                      <td className="px-5 py-3 text-right">{money(i.balanceMinor)}</td>
                      <td className="px-5 py-3"><StatusBadge status={i.overdue ? "overdue" : i.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalInvoice({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const search = new URLSearchParams(useSearch());
  const q = useQuery({ queryKey: ["portal", "invoice", params.id], queryFn: () => get<Any>(`/portal/invoices/${params.id}`), refetchInterval: search.get("attempt") ? 4000 : false });
  const providers = useQuery({ queryKey: ["providers"], queryFn: () => get<{ key: string; label: string; default: boolean }[]>("/checkout/providers") });
  const [payment, setPayment] = useState<PaymentRedirect | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ["portal", "invoice", params.id] });
  async function pay(provider: string) {
    setBusy(true);
    setError(null);
    try {
      setPayment(await post<PaymentRedirect>(`/portal/invoices/${params.id}/pay`, { provider }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <PortalLayout title={q.data ? `Invoice ${q.data.invoice.number}` : "Invoice"} back={{ href: "/portal/invoices", label: "All invoices" }} actions={q.data && <Btn size="sm" variant="secondary" onClick={() => downloadFile(`/portal/invoices/${params.id}/pdf`, `${q.data.invoice.number}.pdf`)}><Download size={14} /> PDF</Btn>}>
      <QueryView query={q}>
        {({ invoice: i, payments, attempts }) => {
          const pendingEft = attempts.find((a: Any) => a.provider === "eft" && ["created", "pending_verification"].includes(a.status));
          return (
            <div className="grid grid-cols-1 xl:grid-cols-[1fr_360px] gap-8 items-start">
              <div className="space-y-6 min-w-0">
                {search.get("attempt") && i.balanceMinor > 0 && <Alert tone="info">Waiting for the payment provider to confirm your payment… this page updates automatically.</Alert>}
                <Card className="p-5">
                  <DefinitionList items={[["Status", <StatusBadge key="s" status={i.overdue ? "overdue" : i.status} />], ["Type", humanize(i.kind)], ["Issued", date(i.issuedAt)], ["Due", date(i.dueAt)], ["Paid", i.paidAt ? date(i.paidAt) : "—"]]} />
                </Card>
                <Card>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[14px] min-w-[420px]">
                      <tbody className="divide-y hairline">
                        {i.lines.map((l: Any, idx: number) => (<tr key={idx}><td className="px-5 py-3">{l.description}</td><td className="px-5 py-3 text-right whitespace-nowrap">{money(l.totalMinor, { decimals: true })}</td></tr>))}
                      </tbody>
                      <tfoot className="border-t hairline text-[14px]">
                        {i.taxMinor > 0 && <tr><td className="px-5 py-2 text-right text-muted">{i.taxLabel}</td><td className="px-5 py-2 text-right">{money(i.taxMinor, { decimals: true })}</td></tr>}
                        <tr><td className="px-5 py-2 text-right font-medium">Total</td><td className="px-5 py-2 text-right font-medium">{money(i.totalMinor, { decimals: true })}</td></tr>
                        <tr><td className="px-5 py-2 text-right text-muted">Paid</td><td className="px-5 py-2 text-right">{money(i.amountPaidMinor, { decimals: true })}</td></tr>
                        {i.amountRefundedMinor > 0 && <tr><td className="px-5 py-2 text-right text-muted">Refunded</td><td className="px-5 py-2 text-right">{money(i.amountRefundedMinor, { decimals: true })}</td></tr>}
                        <tr><td className="px-5 py-3 text-right font-medium">Balance due</td><td className="px-5 py-3 text-right font-serif text-[20px]">{money(i.balanceMinor, { decimals: true })}</td></tr>
                      </tfoot>
                    </table>
                  </div>
                </Card>
                <Card>
                  <CardHeader title="Payment history" />
                  <ul className="divide-y hairline text-[14px]">
                    {payments.length === 0 && attempts.length === 0 && <li className="px-5 py-4 text-muted">No payments yet.</li>}
                    {payments.map((p: Any) => (<li key={p.id} className="px-5 py-3 flex justify-between"><span>{humanize(p.provider)} · {dateTime(p.verifiedAt)}</span><span className="text-[#1E6B3A]">{money(p.amountMinor, { decimals: true })}</span></li>))}
                    {attempts.filter((a: Any) => a.status !== "succeeded").map((a: Any) => (<li key={a.id} className="px-5 py-3 flex justify-between text-muted"><span>{a.reference} · {humanize(a.provider)} · {date(a.createdAt)}{a.failureReason ? ` — ${a.failureReason}` : ""}</span><StatusBadge status={a.status} /></li>))}
                  </ul>
                </Card>
              </div>
              <aside className="space-y-4 xl:sticky xl:top-28">
                {i.balanceMinor > 0 && ["issued", "partially_paid"].includes(i.status) ? (
                  payment ? (
                    payment.eft ? (
                      <><EftInstructions eft={payment.eft} /><Card className="p-5"><p className="text-[14px] text-muted mb-3">Paid already? Upload your proof of payment to speed up confirmation.</p><FileUpload attemptId={payment.attemptId} onDone={refresh} label="Upload proof of payment" /></Card></>
                    ) : (
                      <Card className="p-5"><PaymentHandoff payment={payment} /></Card>
                    )
                  ) : pendingEft ? (
                    <Card className="p-5 space-y-3">
                      <Alert tone="info" title={pendingEft.status === "pending_verification" ? "EFT awaiting verification" : "EFT selected"}>{pendingEft.status === "pending_verification" ? "We've received your proof and will confirm once funds clear." : `Use reference ${pendingEft.reference} when you pay.`}</Alert>
                      {i.eft && <EftInstructions eft={{ ...i.eft, reference: pendingEft.reference, amountMinor: pendingEft.amountMinor }} />}
                      {pendingEft.status === "created" && <FileUpload attemptId={pendingEft.id} onDone={refresh} label="Upload proof of payment" />}
                    </Card>
                  ) : (
                    <Card className="p-5 space-y-3">
                      <div className="text-[12px] uppercase tracking-wider text-faint">Amount due</div>
                      <div className="font-serif text-[30px] text-ink">{money(i.balanceMinor, { decimals: true })}</div>
                      {(providers.data ?? []).map((p) => (
                        <Btn key={p.key} className="w-full" variant={p.key === "eft" ? "secondary" : "primary"} loading={busy} onClick={() => pay(p.key)}>
                          {p.key === "eft" ? "Pay by EFT" : `Pay with ${p.label.replace(/.*\((.*)\)/, "$1")}`}
                        </Btn>
                      ))}
                      {providers.data?.length === 0 && <Alert tone="info">Online payment isn't enabled yet. Please pay by EFT using the details on the PDF.</Alert>}
                      {error && <Alert tone="danger">{error}</Alert>}
                      <p className="text-[12px] text-faint">Payments are processed by our payment partner. We never see your card details.</p>
                    </Card>
                  )
                ) : (
                  <Alert tone={i.status === "paid" ? "success" : "info"} title={i.status === "paid" ? "Paid in full" : humanize(i.status)}>{i.status === "paid" ? `Thank you — paid on ${date(i.paidAt)}.` : null}</Alert>
                )}
              </aside>
            </div>
          );
        }}
      </QueryView>
    </PortalLayout>
  );
}

// ---------------------------------------------------------------- orders, enquiries, requests, notifications
export function PortalOrders() {
  const q = useQuery({ queryKey: ["portal", "orders"], queryFn: () => get<Any[]>("/portal/orders") });
  return (
    <PortalLayout title="Orders">
      <QueryView query={q} empty={<EmptyState title="No orders yet" action={<LinkBtn href="/packages">Browse packages</LinkBtn>} />}>
        {(list) => (
          <Card>
            <ul className="divide-y hairline">
              {list.map((o) => (
                <li key={o.id}><Link href={`/portal/orders/${o.id}`} className="flex flex-wrap justify-between gap-3 px-5 py-4 hover:bg-ink/[0.02]"><span><span className="block text-ink font-medium">{o.title}</span><span className="text-[12px] text-muted">{o.reference} · {date(o.createdAt)}</span></span><span className="flex items-center gap-4"><span>{money(o.totalMinor)}</span><StatusBadge status={o.status} /></span></Link></li>
              ))}
            </ul>
          </Card>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalOrder({ params }: { params: { id: string } }) {
  const q = useQuery({ queryKey: ["portal", "order", params.id], queryFn: () => get<Any>(`/portal/orders/${params.id}`) });
  return (
    <PortalLayout title={q.data ? `Order ${q.data.order.reference}` : "Order"} back={{ href: "/portal/orders", label: "All orders" }}>
      <QueryView query={q}>
        {(d) => (
          <div className="space-y-6">
            {d.order.status === "pending_payment" && (
              <Alert tone="warning" title="Awaiting payment">{d.status.canRetry ? <>Your payment wasn't completed. <Link href={`/checkout/return?order=${d.order.reference}&token=${d.order.accessToken}`} className="underline font-medium">Retry payment</Link></> : "We're waiting for the payment to be confirmed."}</Alert>
            )}
            <Card className="p-5"><DefinitionList items={[["Status", <StatusBadge key="s" status={d.order.status} />], ["Placed", dateTime(d.order.createdAt)], ["Total", money(d.order.totalMinor)], ["Terms accepted", d.order.termsVersion ?? "—"], ["Project", d.project ? <Link key="p" href={`/portal/projects/${d.project.id}`} className="underline">{d.project.name}</Link> : "—"]]} /></Card>
            <Card><CardHeader title="Items" /><ul className="divide-y hairline text-[14px]">{d.items.map((it: Any) => (<li key={it.id} className="px-5 py-3 flex justify-between gap-4"><span>{it.description}</span><span>{money(it.totalMinor)}</span></li>))}</ul></Card>
            <Card><CardHeader title="Invoices" /><ul className="divide-y hairline text-[14px]">{d.invoices.length === 0 && <li className="px-5 py-3 text-muted">None yet.</li>}{d.invoices.map((i: Any) => (<li key={i.id} className="px-5 py-3 flex justify-between gap-4"><Link href={`/portal/invoices/${i.id}`} className="underline">{i.number}</Link><span className="flex items-center gap-3">{money(i.totalMinor)} <StatusBadge status={i.status} /></span></li>))}</ul></Card>
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalEnquiries() {
  const q = useQuery({ queryKey: ["portal", "enquiries"], queryFn: () => get<Any[]>("/portal/enquiries") });
  return (
    <PortalLayout title="Enquiries & estimates" actions={<LinkBtn href="/configure" size="sm">New brief</LinkBtn>}>
      <QueryView query={q} empty={<EmptyState title="No briefs yet" action={<LinkBtn href="/configure">Configure a project</LinkBtn>}>Describe a problem in plain language and get an indicative assessment.</EmptyState>}>
        {(list) => (
          <div className="space-y-4">
            {list.map((e) => (
              <Card key={e.id} className="p-5">
                <div className="flex flex-wrap justify-between gap-3">
                  <div><div className="text-ink font-medium">{e.reference}</div><div className="text-[12px] text-muted">Submitted {date(e.submittedAt)}</div></div>
                  <StatusBadge status={e.status} />
                </div>
                <p className="text-[14px] text-muted mt-3">{e.summary}</p>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <span className="text-[14px]">{e.estimate?.priced ? <>Indicative: <strong className="font-medium">{moneyRange(e.estimate.lowMinor, e.estimate.highMinor)}</strong>{e.estimate.requiresManualReview && <Badge tone="warning" className="ml-2">Under review</Badge>}</> : "Awaiting review"}</span>
                  <Link href={`/portal/enquiries/${e.id}`} className="text-[14px] underline">View assessment</Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalEnquiry({ params }: { params: { id: string } }) {
  const q = useQuery({ queryKey: ["portal", "enquiry", params.id], queryFn: () => get<Any>(`/portal/enquiries/${params.id}`) });
  return (
    <PortalLayout title="Project assessment" back={{ href: "/portal/enquiries", label: "All enquiries" }}>
      <QueryView query={q}>{(v) => <EstimateSummary view={v} />}</QueryView>
    </PortalLayout>
  );
}

export function PortalRequests() {
  const q = useQuery({ queryKey: ["portal", "requests"], queryFn: () => get<Any[]>("/portal/change-requests") });
  return (
    <PortalLayout title="Support & change requests">
      <p className="text-[14px] text-muted -mt-4 mb-6">Raise new requests from a project page. Defects are fixed under warranty; new scope is quoted before work starts.</p>
      <QueryView query={q} empty={<EmptyState title="No requests" />}>
        {(list) => (
          <Card>
            <ul className="divide-y hairline">
              {list.map((c) => (
                <li key={c.id} className="px-5 py-4">
                  <div className="flex flex-wrap justify-between gap-2"><Link href={`/portal/projects/${c.projectId}`} className="text-ink font-medium hover:underline">{c.title}</Link><StatusBadge status={c.status} /></div>
                  <div className="text-[12px] text-muted mt-0.5">{c.reference} · {humanize(c.type)} · {c.projectName} · {date(c.createdAt)}</div>
                  {c.response && <p className="text-[14px] text-muted mt-2">{c.response}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </QueryView>
    </PortalLayout>
  );
}

export function PortalNotifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["portal", "notifications"], queryFn: () => get<Any[]>("/portal/notifications") });
  return (
    <PortalLayout title="Notifications" actions={<Btn size="sm" variant="secondary" onClick={async () => { await post("/portal/notifications/read", {}); qc.invalidateQueries({ queryKey: ["portal", "notifications"] }); qc.invalidateQueries({ queryKey: ["unread"] }); }}>Mark all read</Btn>}>
      <QueryView query={q} empty={<EmptyState title="You're all caught up" />}>
        {(list) => (
          <Card>
            <ul className="divide-y hairline">
              {list.map((n) => (
                <li key={n.id} className={`px-5 py-4 ${n.read ? "" : "bg-[#EAF0F8]/40"}`}>
                  <div className="flex justify-between gap-3">
                    {n.link ? <Link href={n.link.replace(/^https?:\/\/[^/]+/, "")} className="text-ink font-medium hover:underline">{n.subject}</Link> : <span className="text-ink font-medium">{n.subject}</span>}
                    <span className="text-[12px] text-muted whitespace-nowrap">{relative(n.createdAt)}</span>
                  </div>
                  <p className="text-[14px] text-muted mt-1 whitespace-pre-line">{n.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        )}
      </QueryView>
    </PortalLayout>
  );
}

// ---------------------------------------------------------------- profile & security
export function PortalProfile() {
  const { me, refresh } = useAuth();
  const qc = useQueryClient();
  const search = new URLSearchParams(useSearch());
  const [, navigate] = useLocation();
  const setPasswordMode = search.get("setPassword") === "1";
  const orgs = useQuery({ queryKey: ["portal", "organization"], queryFn: () => get<Any[]>("/portal/organization") });
  const [profile, setProfile] = useState<{ name: string; phone: string; prefs: Me["notificationPrefs"] } | null>(null);
  const [pw, setPw] = useState({ currentPassword: "", newPassword: "" });
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  if (!me) return <PortalLayout title="Profile"><LoadingState /></PortalLayout>;
  const p = profile ?? { name: me.name, phone: me.phone ?? "", prefs: me.notificationPrefs };
  const org = orgs.data?.[0];
  return (
    <PortalLayout title="Profile & security">
      <div className="space-y-6 max-w-[760px]">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        {setPasswordMode && <Alert tone="info" title="Set a password (optional)">You signed in with a one-time link. Set a password for faster access next time, or <Link href={safeNext(search.get("next"), "/portal")} className="underline">continue</Link>.</Alert>}
        <Card>
          <CardHeader title="Your details" />
          <form className="p-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); try { await patch("/me", { name: p.name, phone: p.phone || null, notificationPrefs: p.prefs }); await refresh(); setMsg({ tone: "success", text: "Profile saved." }); } catch (err) { setMsg({ tone: "danger", text: errorMessage(err) }); } }}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <TextField label="Name" value={p.name} onChange={(e) => setProfile({ ...p, name: e.target.value })} />
              <TextField label="Phone" value={p.phone} onChange={(e) => setProfile({ ...p, phone: e.target.value })} />
              <TextField label="Email" value={me.email} disabled hint={me.emailVerified ? "Verified" : "Not yet verified"} />
            </div>
            <fieldset className="space-y-2 pt-2">
              <legend className="text-[13px] font-medium text-ink mb-1">Email notifications</legend>
              <Checkbox label="Project updates and milestones" checked={p.prefs.emailProjectUpdates} onChange={(e) => setProfile({ ...p, prefs: { ...p.prefs, emailProjectUpdates: e.target.checked } })} />
              <Checkbox label="Invoices and payment receipts" checked={p.prefs.emailInvoices} onChange={(e) => setProfile({ ...p, prefs: { ...p.prefs, emailInvoices: e.target.checked } })} />
              <Checkbox label="News and insights (marketing)" checked={p.prefs.emailMarketing} onChange={(e) => setProfile({ ...p, prefs: { ...p.prefs, emailMarketing: e.target.checked } })} />
            </fieldset>
            <Btn type="submit" size="sm">Save</Btn>
          </form>
        </Card>
        {org && <OrganizationForm org={org} onSaved={() => { qc.invalidateQueries({ queryKey: ["portal", "organization"] }); setMsg({ tone: "success", text: "Billing details saved." }); }} />}
        <Card>
          <CardHeader title={setPasswordMode ? "Set a password" : "Password"} />
          <form className="p-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); try { await post("/auth/change-password", pw); setPw({ currentPassword: "", newPassword: "" }); await refresh(); setMsg({ tone: "success", text: "Password updated. Other sessions were signed out." }); if (setPasswordMode) navigate(safeNext(search.get("next"), "/portal")); } catch (err) { setMsg({ tone: "danger", text: errorMessage(err) }); } }}>
            {!setPasswordMode && <TextField label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} hint="Leave blank if you've never set one." />}
            <TextField label="New password" type="password" autoComplete="new-password" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} hint="At least 10 characters, including a number." />
            <Btn type="submit" size="sm" disabled={pw.newPassword.length < 10}>Update password</Btn>
          </form>
        </Card>
        <Card>
          <CardHeader title="Security" />
          <div className="p-5 space-y-4 text-[14px]">
            <p>Two-factor authentication: <strong className="font-medium">{me.mfaEnabled ? "On" : "Off"}</strong>. {!me.mfaEnabled && <Link href="/auth/mfa?next=/portal/profile" className="underline">Turn on</Link>}</p>
            <Btn size="sm" variant="secondary" onClick={async () => { await post("/auth/logout-all"); await refresh(); navigate("/login"); }}>Sign out of all devices</Btn>
            <p className="text-[13px] text-muted">To access, correct or delete your personal information, email us — see our <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
          </div>
        </Card>
      </div>
    </PortalLayout>
  );
}

function OrganizationForm({ org, onSaved }: { org: Any; onSaved: () => void }) {
  const [f, setF] = useState({ name: org.name ?? "", registrationNumber: org.registrationNumber ?? "", vatNumber: org.vatNumber ?? "", billingEmail: org.billingEmail ?? "", line1: org.billingAddress?.line1 ?? "", city: org.billingAddress?.city ?? "", postalCode: org.billingAddress?.postalCode ?? "" });
  const [err, setErr] = useState<string | null>(null);
  return (
    <Card>
      <CardHeader title="Company & billing" description="Shown on your invoices." />
      <form className="p-5 space-y-4" onSubmit={async (e) => { e.preventDefault(); try { await patch(`/portal/organization/${org.id}`, { name: f.name, registrationNumber: f.registrationNumber || null, vatNumber: f.vatNumber || null, billingEmail: f.billingEmail || null, billingAddress: { line1: f.line1, city: f.city, postalCode: f.postalCode, country: "ZA" } }); onSaved(); } catch (x) { setErr(errorMessage(x)); } }}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <TextField label="Name on invoices" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <TextField label="Billing email" type="email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} />
          <TextField label="Registration number" value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
          <TextField label="VAT number" value={f.vatNumber} onChange={(e) => setF({ ...f, vatNumber: e.target.value })} />
          <TextField label="Street address" value={f.line1} onChange={(e) => setF({ ...f, line1: e.target.value })} />
          <TextField label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
          <TextField label="Postal code" value={f.postalCode} onChange={(e) => setF({ ...f, postalCode: e.target.value })} />
        </div>
        {err && <Alert tone="danger">{err}</Alert>}
        <Btn type="submit" size="sm">Save billing details</Btn>
      </form>
    </Card>
  );
}

void ErrorState;
