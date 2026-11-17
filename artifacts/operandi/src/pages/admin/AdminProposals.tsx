import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Plus, Trash2 } from "lucide-react";
import type { ProposalBody } from "@workspace/api-zod";
import { allocateByBps } from "@workspace/domain";
import { AdminLayout, LinesField, Table, Td } from "./AdminLayout";
import { get, patch, post, downloadFile, errorMessage } from "@/lib/api";
import { date, dateTime, money, minorToRand, randToMinor, relative, humanize } from "@/lib/format";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, Checkbox, SelectField, StatusBadge, TextArea, TextField } from "@/components/ui-kit";
import { ConfirmButton } from "@/components/ui-kit/overlay";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

export function AdminProposals() {
  const [status, setStatus] = useState("");
  const q = useQuery({ queryKey: ["admin", "proposals", status], queryFn: () => get<Any[]>(`/admin/proposals${status ? `?status=${status}` : ""}`) });
  return (
    <AdminLayout title="Proposals" description="Create proposals from a lead or from a configurator brief.">
      <div className="mb-5 max-w-[240px]">
        <SelectField label="Status" value={status} onChange={(e) => setStatus(e.target.value)} placeholder="All" options={["draft", "sent", "viewed", "accepted", "declined", "expired", "withdrawn"].map((s) => ({ value: s, label: humanize(s) }))} />
      </div>
      <QueryView query={q} empty={<EmptyState title="No proposals yet">Open a lead or a configurator brief to draft one.</EmptyState>}>
        {(list) => (
          <Table head={["Proposal", "Client", "Total", "Status", "Updated"]}>
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/proposals/${p.id}`} className="font-medium hover:underline">{p.title}</Link><span className="block text-[12px] text-muted">{p.reference} · v{p.version}</span></Td>
                <Td>{p.clientName ?? "—"}</Td>
                <Td>{money(p.totalMinor)}</Td>
                <Td><StatusBadge status={p.expired && ["sent", "viewed"].includes(p.status) ? "expired" : p.status} /></Td>
                <Td>{relative(p.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryView>
    </AdminLayout>
  );
}

interface Draft extends Omit<ProposalBody, "lineItems" | "milestones"> {
  lineItems: { description: string; quantity: number; unitRand: string }[];
  milestones: { key: string; title: string; description: string; percent: string; targetOffsetDays: number }[];
}

function toDraft(input: ProposalBody): Draft {
  return {
    ...input,
    lineItems: input.lineItems.map((l) => ({ description: l.description, quantity: l.quantity, unitRand: minorToRand(l.unitMinor) })),
    milestones: input.milestones.map((m) => ({ key: m.key, title: m.title, description: m.description ?? "", percent: String(m.percentBps / 100), targetOffsetDays: m.targetOffsetDays ?? 0 })),
  };
}

function fromDraft(d: Draft): Partial<ProposalBody> {
  return {
    title: d.title,
    summary: d.summary,
    sections: d.sections.filter((s) => s.heading.trim()),
    lineItems: d.lineItems.filter((l) => l.description.trim()).map((l) => ({ description: l.description, quantity: Math.max(1, Number(l.quantity) || 1), unitMinor: randToMinor(l.unitRand) ?? 0 })),
    milestones: d.milestones.map((m) => ({ key: m.key || m.title.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40) || "milestone", title: m.title, description: m.description, percentBps: Math.round(Number(m.percent) * 100) || 0, targetOffsetDays: Number(m.targetOffsetDays) || 0 })),
    depositMilestoneKey: d.depositMilestoneKey,
    assumptions: d.assumptions,
    exclusions: d.exclusions,
    timelineSummary: d.timelineSummary,
    terms: d.terms,
    expiresInDays: d.expiresInDays,
  };
}

export function AdminProposal({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["admin", "proposal", params.id], queryFn: () => get<Any>(`/admin/proposals/${params.id}`) });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState({ body: "", internal: false });
  useEffect(() => {
    if (q.data) setDraft(toDraft(q.data.input));
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "proposal", params.id] });

  const preview = useMemo(() => {
    if (!draft) return null;
    const net = draft.lineItems.reduce((s, l) => s + (randToMinor(l.unitRand) ?? 0) * (Number(l.quantity) || 0), 0);
    const pct = draft.milestones.reduce((s, m) => s + (Math.round(Number(m.percent) * 100) || 0), 0);
    const amounts = pct === 10_000 ? allocateByBps(net, draft.milestones.map((m) => Math.round(Number(m.percent) * 100))) : [];
    return { net, pct, amounts };
  }, [draft]);

  if (!q.data || !draft) return <AdminLayout title="Proposal" back={{ href: "/admin/proposals", label: "Proposals" }}><QueryView query={q}>{() => null}</QueryView></AdminLayout>;
  const { proposal: p, versions, thread, lead, order } = q.data;
  const editable = !["accepted", "superseded"].includes(p.status) && p.isLatest !== false;
  const set = (patchValue: Partial<Draft>) => setDraft({ ...draft, ...patchValue });

  async function save() {
    setBusy(true);
    setMsg(null);
    try {
      const r = await patch<{ id: string; version: number; newVersion: boolean }>(`/admin/proposals/${params.id}`, { ...fromDraft(draft!), rowVersion: p.rowVersion });
      if (r.newVersion) {
        setMsg({ tone: "info", text: `Saved as version ${r.version}. The previous version is superseded; send the new version to the client.` });
        navigate(`/admin/proposals/${r.id}`);
      } else {
        setMsg({ tone: "success", text: "Draft saved." });
        refresh();
      }
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <AdminLayout
      title={p.title}
      back={{ href: "/admin/proposals", label: "Proposals" }}
      description={<>{p.reference} · version {p.version} · <StatusBadge status={p.status} />{lead && <> · <Link href={`/admin/leads/${lead.id}`} className="underline">{lead.contactName}</Link></>}</>}
      actions={
        <>
          <Btn size="sm" variant="secondary" onClick={() => downloadFile(`/admin/proposals/${params.id}/pdf`, `${p.reference}-v${p.version}.pdf`)}><Download size={14} /> PDF</Btn>
          {p.status === "draft" && (
            <ConfirmButton variant="primary" title="Send this proposal?" description={`The client receives version ${p.version} with a total of ${money(p.totalMinor)}. Content is frozen once sent; later edits create a new version.`} confirmLabel="Send to client" onConfirm={async () => { await post(`/admin/proposals/${params.id}/send`, { rowVersion: p.rowVersion }); refresh(); }}>
              Send to client
            </ConfirmButton>
          )}
          {["sent", "viewed"].includes(p.status) && (
            <ConfirmButton title="Withdraw this proposal?" onConfirm={async () => { await post(`/admin/proposals/${params.id}/withdraw`); refresh(); }}>Withdraw</ConfirmButton>
          )}
        </>
      }
    >
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6 items-start">
        <div className="space-y-6 min-w-0">
          {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
          {order && <Alert tone="success" title="Accepted">Order <Link href={`/admin/orders/${order.id}`} className="underline">{order.reference}</Link> was created on acceptance.</Alert>}
          {!editable && <Alert tone="info">This version is {p.status} and can't be edited.</Alert>}
          {editable && p.status !== "draft" && <Alert tone="info">This version has been sent. Saving changes creates version {p.version + 1}.</Alert>}
          <fieldset disabled={!editable} className="space-y-6">
            <Card className="p-5 space-y-4">
              <TextField label="Title" value={draft.title} onChange={(e) => set({ title: e.target.value })} />
              <TextArea label="Summary" rows={4} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
            </Card>
            <Card>
              <CardHeader title="Scope sections" actions={<Btn size="sm" variant="ghost" onClick={() => set({ sections: [...draft.sections, { heading: "", body: "" }] })}><Plus size={14} /> Section</Btn>} />
              <div className="p-5 space-y-5">
                {draft.sections.map((s, i) => (
                  <div key={i} className="space-y-2 border-b hairline pb-5 last:border-0 last:pb-0">
                    <div className="flex gap-2 items-end"><TextField label="Heading" className="flex-1" value={s.heading} onChange={(e) => set({ sections: draft.sections.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} /><Btn variant="ghost" size="sm" aria-label="Remove section" onClick={() => set({ sections: draft.sections.filter((_, j) => j !== i) })}><Trash2 size={14} /></Btn></div>
                    <TextArea label="Body" rows={4} value={s.body} onChange={(e) => set({ sections: draft.sections.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
                  </div>
                ))}
                {draft.sections.length === 0 && <p className="text-[14px] text-muted">No sections yet.</p>}
              </div>
            </Card>
            <Card>
              <CardHeader title="Line items (ZAR, excl. tax)" actions={<Btn size="sm" variant="ghost" onClick={() => set({ lineItems: [...draft.lineItems, { description: "", quantity: 1, unitRand: "0" }] })}><Plus size={14} /> Line</Btn>} />
              <div className="p-5 space-y-3">
                {draft.lineItems.map((l, i) => (
                  <div key={i} className="grid grid-cols-[1fr_80px_130px_auto] gap-2 items-end">
                    <TextField label={i === 0 ? "Description" : ""} aria-label="Description" value={l.description} onChange={(e) => set({ lineItems: draft.lineItems.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)) })} />
                    <TextField label={i === 0 ? "Qty" : ""} aria-label="Quantity" type="number" min={1} value={l.quantity} onChange={(e) => set({ lineItems: draft.lineItems.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)) })} />
                    <TextField label={i === 0 ? "Unit (R)" : ""} aria-label="Unit price in rand" inputMode="decimal" value={l.unitRand} onChange={(e) => set({ lineItems: draft.lineItems.map((x, j) => (j === i ? { ...x, unitRand: e.target.value } : x)) })} />
                    <Btn variant="ghost" size="sm" aria-label="Remove line" onClick={() => set({ lineItems: draft.lineItems.filter((_, j) => j !== i) })}><Trash2 size={14} /></Btn>
                  </div>
                ))}
                <p className="text-[14px] text-right">Net total: <strong>{money(preview?.net ?? 0)}</strong> <span className="text-muted">(tax applied per settings when saved)</span></p>
              </div>
            </Card>
            <Card>
              <CardHeader title="Payment schedule" description="Percentages must total 100%. The deposit milestone is invoiced on acceptance." actions={<Btn size="sm" variant="ghost" onClick={() => set({ milestones: [...draft.milestones, { key: `m${draft.milestones.length + 1}`, title: "", description: "", percent: "0", targetOffsetDays: 0 }] })}><Plus size={14} /> Milestone</Btn>} />
              <div className="p-5 space-y-3">
                {draft.milestones.map((m, i) => (
                  <div key={i} className="grid grid-cols-1 sm:grid-cols-[auto_1fr_90px_110px_auto] gap-2 items-end">
                    <label className="flex items-center gap-1.5 text-[12px] text-muted pb-3"><input type="radio" name="deposit" checked={(draft.depositMilestoneKey ?? draft.milestones[0]?.key) === m.key} onChange={() => set({ depositMilestoneKey: m.key })} className="accent-[#0F1115]" /> Deposit</label>
                    <TextField label={i === 0 ? "Milestone" : ""} aria-label="Milestone title" value={m.title} onChange={(e) => set({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
                    <TextField label={i === 0 ? "%" : ""} aria-label="Percent" inputMode="decimal" value={m.percent} onChange={(e) => set({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, percent: e.target.value } : x)) })} />
                    <TextField label={i === 0 ? "Day offset" : ""} aria-label="Days after acceptance" type="number" min={0} value={m.targetOffsetDays} onChange={(e) => set({ milestones: draft.milestones.map((x, j) => (j === i ? { ...x, targetOffsetDays: Number(e.target.value) } : x)) })} />
                    <Btn variant="ghost" size="sm" aria-label="Remove milestone" onClick={() => set({ milestones: draft.milestones.filter((_, j) => j !== i) })}><Trash2 size={14} /></Btn>
                    {preview?.amounts[i] !== undefined && <p className="sm:col-start-2 text-[12px] text-muted -mt-1">{money(preview.amounts[i])} (before tax)</p>}
                  </div>
                ))}
                <p className={`text-[13px] ${preview?.pct === 10_000 ? "text-muted" : "text-[#9F1D1D]"}`}>Total: {(preview?.pct ?? 0) / 100}%</p>
              </div>
            </Card>
            <Card className="p-5 space-y-4">
              <TextArea label="Timeline" rows={2} value={draft.timelineSummary} onChange={(e) => set({ timelineSummary: e.target.value })} />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <LinesField key={`a-${p.id}`} label="Assumptions" value={draft.assumptions} onChange={(v) => set({ assumptions: v })} />
                <LinesField key={`e-${p.id}`} label="Exclusions" value={draft.exclusions} onChange={(v) => set({ exclusions: v })} />
              </div>
              <TextArea label="Terms" rows={5} value={draft.terms} onChange={(e) => set({ terms: e.target.value })} />
              <TextField label="Valid for (days)" type="number" min={1} max={365} value={draft.expiresInDays} onChange={(e) => set({ expiresInDays: Number(e.target.value) })} className="max-w-[200px]" />
            </Card>
          </fieldset>
          {editable && <div className="flex justify-end"><Btn loading={busy} onClick={save} disabled={preview?.pct !== 10_000}>{p.status === "draft" ? "Save draft" : "Save as new version"}</Btn></div>}
        </div>
        <aside className="space-y-6">
          <Card className="p-5">
            <div className="text-[12px] uppercase tracking-wider text-faint">Saved total</div>
            <div className="font-serif text-[30px]">{money(p.totalMinor)}</div>
            <div className="text-[13px] text-muted">Deposit {money(p.depositMinor)}{p.taxMinor ? ` · incl. ${p.taxLabel} ${money(p.taxMinor)}` : ""}</div>
            <div className="text-[13px] text-muted mt-2">Sent {date(p.sentAt)} · Viewed {date(p.viewedAt)} · Expires {date(p.expiresAt)}</div>
            {p.contentHash && <div className="text-[11px] text-faint mt-2 break-all">Fingerprint {p.contentHash}</div>}
          </Card>
          <Card>
            <CardHeader title="Versions" />
            <ul className="divide-y hairline text-[14px]">
              {versions.map((v: Any) => (<li key={v.id}><Link href={`/admin/proposals/${v.id}`} className={`flex justify-between px-5 py-2.5 ${v.id === p.id ? "font-medium" : ""}`}><span>v{v.version} · {money(v.totalMinor)}</span><StatusBadge status={v.status} /></Link></li>))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Clarifications" />
            <ul className="divide-y hairline max-h-[360px] overflow-y-auto">
              {thread.length === 0 && <li className="px-5 py-3 text-[14px] text-muted">No messages.</li>}
              {thread.map((m: Any) => (<li key={m.id} className="px-5 py-3 text-[14px]"><div className="text-[12px] text-muted flex gap-2">{m.authorName ?? "—"} · {relative(m.createdAt)}{m.internal && <Badge tone="warning">Internal</Badge>}</div><p className="mt-1 whitespace-pre-line">{m.body}</p></li>))}
            </ul>
            <form className="p-5 border-t hairline space-y-2" onSubmit={async (e) => { e.preventDefault(); await post(`/admin/proposals/${params.id}/messages`, reply); setReply({ body: "", internal: false }); refresh(); }}>
              <TextArea label="Reply" rows={3} value={reply.body} onChange={(e) => setReply({ ...reply, body: e.target.value })} />
              <Checkbox label="Internal note (not visible to client)" checked={reply.internal} onChange={(e) => setReply({ ...reply, internal: e.target.checked })} />
              <Btn type="submit" size="sm" disabled={!reply.body.trim()}>Post</Btn>
            </form>
          </Card>
        </aside>
      </div>
    </AdminLayout>
  );
}
