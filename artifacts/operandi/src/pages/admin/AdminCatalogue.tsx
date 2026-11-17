import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { pricingRulesSchema, estimateProject, DEMO_PRICING_RULES } from "@workspace/domain";
import { AdminLayout, LinesField, Table, Td } from "./AdminLayout";
import { get, post, put, patch, errorMessage, fieldErrors } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { date, dateTime, money, minorToRand, randToMinor, humanize, percent } from "@/lib/format";
import { QueryView, EmptyState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Card, CardHeader, Checkbox, SelectField, StatusBadge, TextArea, TextField } from "@/components/ui-kit";
import { ConfirmButton, Modal } from "@/components/ui-kit/overlay";

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// ================================================================ packages
export function AdminPackages() {
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["admin", "packages"], queryFn: () => get<Any[]>("/admin/packages") });
  return (
    <AdminLayout title="Packages" description="Productised offerings. Price changes create a new version; existing orders keep the version they bought." actions={<Btn size="sm" onClick={() => navigate("/admin/packages/new")}>New package</Btn>}>
      <QueryView query={q} empty={<EmptyState title="No packages yet" />}>
        {(list) => (
          <Table head={["Package", "Pricing", "From", "Status", "Version", "Orders", "Updated"]}>
            {list.map((p) => (
              <tr key={p.id} className="hover:bg-ink/[0.02]">
                <Td><Link href={`/admin/packages/${p.id}`} className="font-medium hover:underline">{p.name}</Link><span className="block text-[12px] text-muted">/{p.slug}{p.isDiscovery ? " · discovery" : ""}</span></Td>
                <Td>{humanize(p.pricingMode)}</Td>
                <Td>{money(p.fromPriceMinor)}</Td>
                <Td><StatusBadge status={p.status} />{p.soldOut && <Badge tone="warning" className="ml-1">Full</Badge>}</Td>
                <Td>v{p.version}</Td>
                <Td>{p.ordersCount}</Td>
                <Td>{date(p.updatedAt)}</Td>
              </tr>
            ))}
          </Table>
        )}
      </QueryView>
    </AdminLayout>
  );
}

const EMPTY_PACKAGE = { slug: "", name: "", summary: "", description: "", audience: "both", categorySlug: null, pricingMode: "fixed", priceMinor: 0, deliveryWindow: "", deliverables: [], inclusions: [], exclusions: [], clientResponsibilities: [], nextSteps: [], revisions: "", warrantySupport: "", eligibility: "", cancellationTerms: "", deposit: { type: "percent", percentBps: 5000 }, capacityLimit: null, isDiscovery: false, featured: false, displayOrder: 0, variants: [], options: [], status: "draft", version: 1 };

export function AdminPackage({ params }: { params: { id: string } }) {
  const isNew = params.id === "new";
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["admin", "package", params.id], queryFn: () => get<Any>(`/admin/packages/${params.id}`), enabled: !isNew });
  const services = useQuery({ queryKey: ["services"], queryFn: () => get<Any[]>("/services") });
  const [f, setF] = useState<Any>(isNew ? EMPTY_PACKAGE : null);
  const [price, setPrice] = useState("0");
  const [msg, setMsg] = useState<{ tone: "success" | "danger"; text: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [variantEdit, setVariantEdit] = useState<Any | null>(null);
  const [optionEdit, setOptionEdit] = useState<Any | null>(null);
  useEffect(() => {
    if (q.data) {
      setF(q.data);
      setPrice(minorToRand(q.data.priceMinor));
    }
  }, [q.data]);
  if (!f) return <AdminLayout title="Package" back={{ href: "/admin/packages", label: "Packages" }}><QueryView query={q}>{() => null}</QueryView></AdminLayout>;
  const set = (patchValue: Any) => setF({ ...f, ...patchValue });
  const body = () => ({
    slug: f.slug, name: f.name, summary: f.summary, description: f.description, audience: f.audience, categorySlug: f.categorySlug || null, pricingMode: f.pricingMode, priceMinor: randToMinor(price) ?? 0, deliveryWindow: f.deliveryWindow,
    deliverables: f.deliverables, inclusions: f.inclusions, exclusions: f.exclusions, clientResponsibilities: f.clientResponsibilities, nextSteps: f.nextSteps, revisions: f.revisions, warrantySupport: f.warrantySupport, eligibility: f.eligibility, cancellationTerms: f.cancellationTerms, deposit: f.deposit, capacityLimit: f.capacityLimit, isDiscovery: f.isDiscovery, featured: f.featured, displayOrder: Number(f.displayOrder) || 0,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "package", params.id] });
  async function save() {
    setMsg(null);
    setErrors({});
    try {
      if (isNew) {
        const r = await post<Any>("/admin/packages", body());
        navigate(`/admin/packages/${r.id}`);
      } else {
        await put(`/admin/packages/${params.id}`, body());
        setMsg({ tone: "success", text: "Saved." });
        refresh();
      }
    } catch (e) {
      setErrors(fieldErrors(e));
      setMsg({ tone: "danger", text: errorMessage(e) });
    }
  }
  const setStatus = async (status: string) => {
    try {
      await post(`/admin/packages/${params.id}/status`, { status });
      refresh();
      qc.invalidateQueries({ queryKey: ["packages"] });
    } catch (e) {
      setMsg({ tone: "danger", text: errorMessage(e) });
    }
  };
  return (
    <AdminLayout
      title={isNew ? "New package" : f.name}
      back={{ href: "/admin/packages", label: "Packages" }}
      description={!isNew && <>Version {f.version} · <StatusBadge status={f.status} /> · <a href={`/packages/${f.slug}`} target="_blank" rel="noreferrer" className="underline">View public page</a></>}
      actions={!isNew && (
        <>
          {f.status !== "published" && <ConfirmButton variant="primary" title="Publish this package?" description="It becomes visible and purchasable (if fixed-price) on the public site." confirmLabel="Publish" onConfirm={() => setStatus("published")}>Publish</ConfirmButton>}
          {f.status === "published" && <Btn size="sm" variant="secondary" onClick={() => setStatus("paused")}>Pause sales</Btn>}
          {f.status !== "draft" && f.status !== "archived" && <Btn size="sm" variant="ghost" onClick={() => setStatus("draft")}>Unpublish</Btn>}
          {f.status !== "archived" && <ConfirmButton title="Archive this package?" description="Hidden from the site; existing orders are unaffected." onConfirm={() => setStatus("archived")}>Archive</ConfirmButton>}
        </>
      )}
    >
      <div className="space-y-6 max-w-[980px]">
        {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
        <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <TextField label="Name" value={f.name} onChange={(e) => set({ name: e.target.value })} error={errors.name} />
          <TextField label="Slug (URL)" value={f.slug} onChange={(e) => set({ slug: e.target.value })} error={errors.slug} hint="Lowercase letters, numbers and hyphens." />
          <TextArea label="Summary" rows={2} className="md:col-span-2" value={f.summary} onChange={(e) => set({ summary: e.target.value })} />
          <TextArea label="Description" rows={4} className="md:col-span-2" value={f.description} onChange={(e) => set({ description: e.target.value })} />
          <SelectField label="Category" value={f.categorySlug ?? ""} onChange={(e) => set({ categorySlug: e.target.value || null })} placeholder="None" options={(services.data ?? []).map((s) => ({ value: s.slug, label: s.name }))} />
          <SelectField label="Audience" value={f.audience} onChange={(e) => set({ audience: e.target.value })} options={[{ value: "both", label: "Businesses & individuals" }, { value: "b2b", label: "Businesses" }, { value: "b2c", label: "Individuals" }]} />
        </Card>
        <Card className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
          <SelectField label="Pricing mode" value={f.pricingMode} onChange={(e) => set({ pricingMode: e.target.value })} options={[{ value: "fixed", label: "Fixed price (buy online)" }, { value: "starting_from", label: "Starting from (proposal)" }, { value: "quote_only", label: "Quote only (proposal)" }]} />
          <TextField label="Base price (R, excl. tax)" value={price} onChange={(e) => setPrice(e.target.value)} hint="Ignored when tiers exist." />
          <TextField label="Delivery window" value={f.deliveryWindow} onChange={(e) => set({ deliveryWindow: e.target.value })} placeholder="e.g. 4–6 weeks" />
          <SelectField label="Payment at checkout" value={f.deposit.type} onChange={(e) => set({ deposit: e.target.value === "percent" ? { type: "percent", percentBps: 5000 } : e.target.value === "fixed" ? { type: "fixed", amountMinor: 0 } : { type: e.target.value } })} options={[{ value: "percent", label: "Percentage deposit" }, { value: "fixed", label: "Fixed deposit" }, { value: "full", label: "Full amount" }, { value: "none", label: "Nothing (invoice later)" }]} />
          {f.deposit.type === "percent" && <TextField label="Deposit %" type="number" value={f.deposit.percentBps / 100} onChange={(e) => set({ deposit: { type: "percent", percentBps: Math.round(Number(e.target.value) * 100) } })} />}
          {f.deposit.type === "fixed" && <TextField label="Deposit (R)" value={minorToRand(f.deposit.amountMinor)} onChange={(e) => set({ deposit: { type: "fixed", amountMinor: randToMinor(e.target.value) ?? 0 } })} />}
          <TextField label="Capacity (active orders)" type="number" value={f.capacityLimit ?? ""} onChange={(e) => set({ capacityLimit: e.target.value === "" ? null : Number(e.target.value) })} hint="Blank = unlimited." />
          <TextField label="Display order" type="number" value={f.displayOrder} onChange={(e) => set({ displayOrder: e.target.value })} />
          <div className="flex flex-col gap-2 pt-6"><Checkbox label="Featured on home page" checked={f.featured} onChange={(e) => set({ featured: e.target.checked })} /><Checkbox label="Discovery product" checked={f.isDiscovery} onChange={(e) => set({ isDiscovery: e.target.checked })} /></div>
        </Card>
        <Card className="p-5 grid grid-cols-1 md:grid-cols-2 gap-4">
          <LinesField key={`d-${f.id}`} label="Deliverables" value={f.deliverables} onChange={(v) => set({ deliverables: v })} />
          <LinesField key={`i-${f.id}`} label="Inclusions" value={f.inclusions} onChange={(v) => set({ inclusions: v })} />
          <LinesField key={`x-${f.id}`} label="Exclusions" value={f.exclusions} onChange={(v) => set({ exclusions: v })} />
          <LinesField key={`c-${f.id}`} label="Client responsibilities" value={f.clientResponsibilities} onChange={(v) => set({ clientResponsibilities: v })} />
          <LinesField key={`n-${f.id}`} label="Next steps" value={f.nextSteps} onChange={(v) => set({ nextSteps: v })} />
          <div className="space-y-4">
            <TextField label="Revisions" value={f.revisions} onChange={(e) => set({ revisions: e.target.value })} />
            <TextField label="Warranty & support" value={f.warrantySupport} onChange={(e) => set({ warrantySupport: e.target.value })} />
            <TextField label="Eligibility" value={f.eligibility} onChange={(e) => set({ eligibility: e.target.value })} />
          </div>
          <TextArea label="Cancellation & refund terms (shown before checkout)" rows={3} className="md:col-span-2" value={f.cancellationTerms} onChange={(e) => set({ cancellationTerms: e.target.value })} />
        </Card>
        <div className="flex justify-end"><Btn onClick={save}>{isNew ? "Create package" : "Save package"}</Btn></div>

        {!isNew && (
          <>
            <Card>
              <CardHeader title="Tiers" description="e.g. Starter / Growth / Advanced. When tiers exist, the customer must choose one." actions={<Btn size="sm" variant="ghost" onClick={() => setVariantEdit({ key: "", name: "", description: "", priceRand: "", deliveryWindow: "", inclusions: [], recommended: false, active: true, displayOrder: f.variants.length + 1 })}><Plus size={14} /> Tier</Btn>} />
              <ul className="divide-y hairline text-[14px]">
                {f.variants.length === 0 && <li className="px-5 py-3 text-muted">No tiers — the base price applies.</li>}
                {f.variants.map((v: Any) => (<li key={v.id} className="px-5 py-3 flex justify-between gap-3"><span>{v.name} <span className="text-muted">({v.key})</span>{!v.active && <Badge className="ml-2">Inactive</Badge>}{v.recommended && <Badge tone="accent" className="ml-2">Popular</Badge>}</span><span className="flex items-center gap-3">{money(v.priceMinor)}<Btn size="sm" variant="ghost" onClick={() => setVariantEdit({ ...v, priceRand: minorToRand(v.priceMinor) })}>Edit</Btn></span></li>))}
              </ul>
            </Card>
            <Card>
              <CardHeader title="Add-ons" actions={<Btn size="sm" variant="ghost" onClick={() => setOptionEdit({ key: "", label: "", description: "", pricingType: "fixed", amountRand: "", unitLabel: "", minQty: 1, maxQty: 1, rules: { requires: [], excludes: [], variants: [] }, active: true, displayOrder: f.options.length + 1 })}><Plus size={14} /> Add-on</Btn>} />
              <ul className="divide-y hairline text-[14px]">
                {f.options.length === 0 && <li className="px-5 py-3 text-muted">No add-ons.</li>}
                {f.options.map((o: Any) => (<li key={o.id} className="px-5 py-3 flex justify-between gap-3"><span>{o.label} <span className="text-muted">({o.key} · {humanize(o.pricingType)})</span>{!o.active && <Badge className="ml-2">Inactive</Badge>}{(o.rules.requires.length > 0 || o.rules.excludes.length > 0 || o.rules.variants.length > 0) && <span className="block text-[12px] text-muted">{o.rules.requires.length ? `requires ${o.rules.requires.join(", ")} ` : ""}{o.rules.excludes.length ? `excludes ${o.rules.excludes.join(", ")} ` : ""}{o.rules.variants.length ? `tiers ${o.rules.variants.join(", ")}` : ""}</span>}</span><span className="flex items-center gap-3">{o.pricingType === "manual_review" ? "on review" : money(o.amountMinor)}<Btn size="sm" variant="ghost" onClick={() => setOptionEdit({ ...o, amountRand: minorToRand(o.amountMinor), unitLabel: o.unitLabel ?? "" })}>Edit</Btn></span></li>))}
              </ul>
            </Card>
          </>
        )}
      </div>
      <Modal open={Boolean(variantEdit)} onOpenChange={(v) => !v && setVariantEdit(null)} title={variantEdit?.id ? "Edit tier" : "New tier"} footer={<Btn size="sm" onClick={async () => { try { const v = variantEdit; const b = { key: v.key, name: v.name, description: v.description, priceMinor: randToMinor(v.priceRand) ?? 0, deliveryWindow: v.deliveryWindow, inclusions: v.inclusions, recommended: v.recommended, active: v.active, displayOrder: Number(v.displayOrder) || 0 }; if (v.id) await put(`/admin/packages/${params.id}/variants/${v.id}`, b); else await post(`/admin/packages/${params.id}/variants`, b); setVariantEdit(null); refresh(); } catch (e) { setMsg({ tone: "danger", text: errorMessage(e) }); setVariantEdit(null); } }}>Save tier</Btn>}>
        {variantEdit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><TextField label="Name" value={variantEdit.name} onChange={(e) => setVariantEdit({ ...variantEdit, name: e.target.value })} /><TextField label="Key" value={variantEdit.key} disabled={Boolean(variantEdit.id)} onChange={(e) => setVariantEdit({ ...variantEdit, key: e.target.value })} hint="e.g. growth" /></div>
            <div className="grid grid-cols-2 gap-3"><TextField label="Price (R)" value={variantEdit.priceRand} onChange={(e) => setVariantEdit({ ...variantEdit, priceRand: e.target.value })} /><TextField label="Delivery" value={variantEdit.deliveryWindow} onChange={(e) => setVariantEdit({ ...variantEdit, deliveryWindow: e.target.value })} /></div>
            <TextArea label="Description" rows={2} value={variantEdit.description} onChange={(e) => setVariantEdit({ ...variantEdit, description: e.target.value })} />
            <LinesField label="Inclusions" value={variantEdit.inclusions} onChange={(v) => setVariantEdit({ ...variantEdit, inclusions: v })} rows={3} />
            <div className="flex gap-6"><Checkbox label="Popular" checked={variantEdit.recommended} onChange={(e) => setVariantEdit({ ...variantEdit, recommended: e.target.checked })} /><Checkbox label="Active" checked={variantEdit.active} onChange={(e) => setVariantEdit({ ...variantEdit, active: e.target.checked })} /></div>
          </div>
        )}
      </Modal>
      <Modal open={Boolean(optionEdit)} onOpenChange={(v) => !v && setOptionEdit(null)} title={optionEdit?.id ? "Edit add-on" : "New add-on"} wide footer={<Btn size="sm" onClick={async () => { try { const o = optionEdit; const b = { key: o.key, label: o.label, description: o.description, pricingType: o.pricingType, amountMinor: randToMinor(o.amountRand) ?? 0, unitLabel: o.unitLabel || null, minQty: Number(o.minQty), maxQty: Number(o.maxQty), rules: o.rules, active: o.active, displayOrder: Number(o.displayOrder) || 0 }; if (o.id) await put(`/admin/packages/${params.id}/options/${o.id}`, b); else await post(`/admin/packages/${params.id}/options`, b); setOptionEdit(null); refresh(); } catch (e) { setMsg({ tone: "danger", text: errorMessage(e) }); setOptionEdit(null); } }}>Save add-on</Btn>}>
        {optionEdit && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3"><TextField label="Label" value={optionEdit.label} onChange={(e) => setOptionEdit({ ...optionEdit, label: e.target.value })} /><TextField label="Key" value={optionEdit.key} disabled={Boolean(optionEdit.id)} onChange={(e) => setOptionEdit({ ...optionEdit, key: e.target.value })} /></div>
            <TextArea label="Description" rows={2} value={optionEdit.description} onChange={(e) => setOptionEdit({ ...optionEdit, description: e.target.value })} />
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <SelectField label="Pricing" value={optionEdit.pricingType} onChange={(e) => setOptionEdit({ ...optionEdit, pricingType: e.target.value })} options={[{ value: "fixed", label: "Fixed" }, { value: "per_unit", label: "Per unit" }, { value: "manual_review", label: "Manual review" }]} />
              <TextField label="Amount (R)" value={optionEdit.amountRand} onChange={(e) => setOptionEdit({ ...optionEdit, amountRand: e.target.value })} />
              <TextField label="Unit label" value={optionEdit.unitLabel} onChange={(e) => setOptionEdit({ ...optionEdit, unitLabel: e.target.value })} />
              <div className="grid grid-cols-2 gap-2"><TextField label="Min" type="number" value={optionEdit.minQty} onChange={(e) => setOptionEdit({ ...optionEdit, minQty: e.target.value })} /><TextField label="Max" type="number" value={optionEdit.maxQty} onChange={(e) => setOptionEdit({ ...optionEdit, maxQty: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {(["requires", "excludes", "variants"] as const).map((k) => (
                <TextField key={k} label={k === "variants" ? "Only with tiers (keys)" : k === "requires" ? "Requires add-ons (keys)" : "Excludes add-ons (keys)"} value={optionEdit.rules[k].join(", ")} onChange={(e) => setOptionEdit({ ...optionEdit, rules: { ...optionEdit.rules, [k]: e.target.value.split(",").map((s: string) => s.trim()).filter(Boolean) } })} hint="Comma separated" />
              ))}
            </div>
            <Checkbox label="Active" checked={optionEdit.active} onChange={(e) => setOptionEdit({ ...optionEdit, active: e.target.checked })} />
          </div>
        )}
      </Modal>
    </AdminLayout>
  );
}

// ================================================================ pricing rules
export function AdminPricing() {
  const [, navigate] = useLocation();
  const q = useQuery({ queryKey: ["admin", "pricing"], queryFn: () => get<Any[]>("/admin/pricing-rules") });
  return (
    <AdminLayout
      title="Pricing rules"
      description="Versioned, deterministic coefficients for configurator estimates. Active versions are immutable; edit a draft and activate it."
      actions={<Btn size="sm" onClick={async () => { const active = q.data?.find((v) => v.status === "active") ?? q.data?.[0]; const src = active ? (await get<Any>(`/admin/pricing-rules/${active.id}`)).rules : DEMO_PRICING_RULES; const r = await post<Any>("/admin/pricing-rules", { name: `Draft from v${active?.version ?? "demo"}`, rules: src, isDemo: false }); navigate(`/admin/pricing/${r.id}`); }}>New draft version</Btn>}
    >
      <QueryView query={q} empty={<EmptyState title="No pricing versions" />}>
        {(list) => (
          <Table head={["Version", "Name", "Status", "Effective", "Approved"]}>
            {list.map((v) => (<tr key={v.id} className="hover:bg-ink/[0.02]"><Td><Link href={`/admin/pricing/${v.id}`} className="font-medium hover:underline">v{v.version}</Link></Td><Td>{v.name}{v.isDemo && <Badge tone="warning" className="ml-2">Demo</Badge>}</Td><Td><StatusBadge status={v.status} /></Td><Td>{date(v.effectiveFrom)}</Td><Td>{date(v.approvedAt)}</Td></tr>))}
          </Table>
        )}
      </QueryView>
    </AdminLayout>
  );
}

const SAMPLE_ANSWERS = {
  context: { clientType: "company", name: "Sample Client", email: "sample@example.co.za", company: "Sample (Pty) Ltd", country: "ZA" },
  problem: { description: "Our operations run on spreadsheets and WhatsApp and orders get lost every week." },
  solution: { types: ["internal_system"] },
  users: { internalBand: "11_50", customerBand: "none", roleBand: "two_three" },
  capabilities: { features: ["user_accounts", "roles_permissions", "reporting"] },
  integrations: { items: [{ key: "accounting", vendor: "Xero", apiAvailable: "yes" }] },
  platforms: { platforms: ["web"], branding: "partial" },
  migration: { level: "light" },
  budget: { budgetBand: "not_sure", launchTarget: "flexible", urgency: "standard" },
  review: { consentProcessing: true },
};

export function AdminPricingVersion({ params }: { params: { id: string } }) {
  const qc = useQueryClient();
  const { can } = useAuth();
  const q = useQuery({ queryKey: ["admin", "pricing", params.id], queryFn: () => get<Any>(`/admin/pricing-rules/${params.id}`) });
  const [json, setJson] = useState("");
  const [answers, setAnswers] = useState(JSON.stringify(SAMPLE_ANSWERS, null, 2));
  const [msg, setMsg] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [preview, setPreview] = useState<Any>(null);
  useEffect(() => {
    if (q.data) setJson(JSON.stringify(q.data.rules, null, 2));
  }, [q.data]);
  const refresh = () => qc.invalidateQueries({ queryKey: ["admin", "pricing"] });
  function parse(): Any | null {
    try {
      const obj = JSON.parse(json);
      const r = pricingRulesSchema.safeParse(obj);
      if (!r.success) {
        setMsg({ tone: "danger", text: r.error.issues.slice(0, 6).map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ") });
        return null;
      }
      return r.data;
    } catch (e) {
      setMsg({ tone: "danger", text: `Invalid JSON: ${(e as Error).message}` });
      return null;
    }
  }
  return (
    <AdminLayout title={q.data ? `Pricing v${q.data.version}` : "Pricing"} back={{ href: "/admin/pricing", label: "Pricing rules" }} description={q.data && <>{q.data.name} · <StatusBadge status={q.data.status} />{q.data.isDemo && <Badge tone="warning" className="ml-2">Demo — not an approved rate card</Badge>}</>}>
      <QueryView query={q}>
        {(v) => (
          <div className="grid grid-cols-1 xl:grid-cols-[1fr_420px] gap-6 items-start">
            <div className="space-y-4 min-w-0">
              {msg && <Alert tone={msg.tone}>{msg.text}</Alert>}
              <Card>
                <CardHeader title="Rules (JSON)" description="Amounts are ZAR cents; ratios are basis points (10 000 = 100%). Validated against the same schema the server enforces." />
                <textarea aria-label="Pricing rules JSON" value={json} onChange={(e) => setJson(e.target.value)} readOnly={v.status !== "draft"} spellCheck={false} className="w-full h-[560px] font-mono text-[12px] p-4 bg-white focus:outline-none" />
              </Card>
              <div className="flex flex-wrap gap-2 justify-end">
                <Btn variant="secondary" onClick={() => { const r = parse(); if (r) setMsg({ tone: "success", text: "Rules are valid." }); }}>Validate</Btn>
                {v.status === "draft" && <Btn onClick={async () => { const r = parse(); if (!r) return; try { await patch(`/admin/pricing-rules/${params.id}`, { rules: r, rowVersion: v.rowVersion }); setMsg({ tone: "success", text: "Draft saved." }); qc.invalidateQueries({ queryKey: ["admin", "pricing", params.id] }); } catch (e) { setMsg({ tone: "danger", text: errorMessage(e) }); } }}>Save draft</Btn>}
                {v.status !== "active" && (can("pricing.approve") || v.isDemo) && (
                  <ConfirmButton variant="primary" title={`Activate v${v.version}?`} description="New configurator estimates will use these rules immediately. Existing estimates keep the version they were calculated with." confirmLabel="Approve & activate" onConfirm={async () => { await post(`/admin/pricing-rules/${params.id}/activate`, { rowVersion: v.rowVersion }); refresh(); qc.invalidateQueries({ queryKey: ["admin", "pricing", params.id] }); }}>Approve & activate</ConfirmButton>
                )}
                {v.status !== "active" && !can("pricing.approve") && !v.isDemo && <p className="text-[13px] text-muted self-center">Only the owner can approve a production rate card.</p>}
              </div>
            </div>
            <Card>
              <CardHeader title="Preview" description="Run sample answers through these rules (nothing is saved)." />
              <div className="p-5 space-y-3">
                <textarea aria-label="Sample answers JSON" value={answers} onChange={(e) => setAnswers(e.target.value)} spellCheck={false} className="w-full h-[220px] font-mono text-[11px] p-3 border border-rule rounded-sm bg-white" />
                <Btn size="sm" variant="secondary" onClick={() => { const r = parse(); if (!r) return; try { const a = JSON.parse(answers); setPreview(estimateProject(a, r)); setMsg(null); } catch (e) { setPreview(null); setMsg({ tone: "danger", text: (e as Error).message }); } }}>Run preview</Btn>
                {preview && (
                  <div className="text-[13px] space-y-2 border-t hairline pt-3">
                    <p className="font-serif text-[22px]">{money(preview.lowMinor)} – {money(preview.highMinor)}</p>
                    <p className="text-muted">Point {money(preview.totalMinor)} · {preview.confidence} confidence · {preview.timeline.minWeeks}–{preview.timeline.maxWeeks} weeks · deposit {money(preview.depositMinor)} ({percent(preview.depositPercentBps)})</p>
                    <p className="text-muted">Recommendation: {humanize(preview.recommendation)}{preview.flags.length ? ` · flags: ${preview.flags.map((f: Any) => f.code).join(", ")}` : ""}</p>
                    <ul className="divide-y hairline">{preview.lineItems.map((l: Any) => (<li key={l.category + l.key} className="flex justify-between py-1"><span>{l.label}</span><span>{money(l.amountMinor)}</span></li>))}</ul>
                  </div>
                )}
                <p className="text-[12px] text-faint">Created {dateTime(v.createdAt)}{v.approvedAt ? ` · approved ${dateTime(v.approvedAt)}` : ""}</p>
              </div>
            </Card>
          </div>
        )}
      </QueryView>
    </AdminLayout>
  );
}
