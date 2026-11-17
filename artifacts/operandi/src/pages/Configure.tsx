import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Check, CloudOff, Loader2, Mail, Pencil } from "lucide-react";
import { CONFIGURATOR_STEPS, STEP_SCHEMAS, type ConfiguratorDraftAnswers, type ConfiguratorStepKey } from "@workspace/domain";
import type { EstimateView } from "@workspace/api-zod";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { get, patch, post, errorMessage, fieldErrors, newIdempotencyKey, statusOf } from "@/lib/api";
import { attribution, trackEvent } from "@/lib/analytics";
import { useAuth } from "@/lib/auth";
import { LoadingState, ErrorState } from "@/components/ui-kit/states";
import { Alert, Badge, Btn, Checkbox, ChoiceCard, SelectField, TextArea, TextField } from "@/components/ui-kit";

interface Opt {
  key: string;
  label: string;
  description?: string;
}
interface Schema {
  enabled: boolean;
  pricingActive: boolean;
  demoPricing: boolean;
  steps: { key: ConfiguratorStepKey; label: string }[];
  solutions: (Opt & { examples: string[] })[];
  featureGroups: Opt[];
  features: (Opt & { groupKey: string; solutions: string[]; requires: string[]; sensitive: boolean })[];
  integrations: (Opt & { examples: string[] })[];
  platforms: (Opt & { native: boolean })[];
  internalUserBands: Opt[];
  customerUserBands: Opt[];
  roleBands: Opt[];
  migrationLevels: Opt[];
  brandingReadiness: Opt[];
  urgency: Opt[];
  budgetBands: Opt[];
  launchTargets: Opt[];
}
interface DraftResponse {
  token?: string;
  answers: ConfiguratorDraftAnswers;
  currentStep: string;
  submitted: boolean;
  submissionReference: string | null;
}

type Answers = ConfiguratorDraftAnswers;
type SaveState = "idle" | "saving" | "saved" | "error";

const TOKEN_KEY = "operandis.configurator.token";
const IDEM_KEY = "operandis.configurator.idem";
const EXAMPLES = [
  "We manage bookings over WhatsApp and a paper diary, and double-bookings cost us clients every week.",
  "Our sales team re-types every order from our online store into our accounting system.",
  "We want to sell our in-house scheduling tool to other companies in our industry.",
  "Field technicians fill in paper job cards that only reach the office days later.",
];

const DEFAULTS: Answers = {
  context: { clientType: "company", country: "ZA" },
  solution: { types: [] },
  capabilities: { features: [] },
  integrations: { items: [] },
  platforms: { platforms: ["web"] },
  migration: { level: "none", sourceOwnershipKnown: true, contentReady: "partial", hasDomainHosting: false },
  budget: { urgency: "standard" },
  review: { contactPreference: "email", consentProcessing: false, consentMarketing: false },
};

function readToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
function writeToken(t: string | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: server draft + resume email still work */
  }
}

export default function Configure() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const { me } = useAuth();
  const schemaQ = useQuery({ queryKey: ["configurator-schema"], queryFn: () => get<Schema>("/configurator/schema"), staleTime: 10 * 60_000 });
  const [answers, setAnswers] = useState<Answers>(DEFAULTS);
  const [step, setStep] = useState(0);
  const [token, setToken] = useState<string | null>(null);
  const [loadingDraft, setLoadingDraft] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [resumeSent, setResumeSent] = useState(false);
  const dirty = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const tokenRef = useRef<string | null>(null);
  tokenRef.current = token;

  // ---------------------------------------------------------------- load / resume draft
  useEffect(() => {
    const resume = new URLSearchParams(search).get("resume");
    const t = resume ?? readToken();
    if (!t) {
      setLoadingDraft(false);
      return;
    }
    get<DraftResponse>(`/configurator/drafts/${t}`)
      .then((d) => {
        if (d.submitted && d.submissionReference) {
          writeToken(null);
          return;
        }
        setToken(t);
        writeToken(t);
        setAnswers({ ...DEFAULTS, ...d.answers });
        const idx = CONFIGURATOR_STEPS.findIndex((s) => s.key === d.currentStep);
        setStep(Math.max(0, idx));
      })
      .catch((e) => {
        if (statusOf(e) === 404) writeToken(null);
      })
      .finally(() => setLoadingDraft(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (me && !answers.context?.email) {
      setAnswers((a) => ({ ...a, context: { ...a.context, name: a.context?.name || me.name, email: me.email, company: a.context?.company || me.organizations[0]?.name } }));
    }
  }, [me]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------------------------------------------------------------- autosave (debounced + on step change)
  const save = useCallback(
    async (data: Answers, stepIdx: number, opts: { sendResumeLink?: boolean } = {}) => {
      setSaveState("saving");
      try {
        const currentStep = CONFIGURATOR_STEPS[stepIdx].key;
        if (!tokenRef.current) {
          const created = await post<DraftResponse>("/configurator/drafts", { answers: data, currentStep });
          setToken(created.token!);
          tokenRef.current = created.token!;
          writeToken(created.token!);
          trackEvent("configurator_started");
          if (opts.sendResumeLink) await patch(`/configurator/drafts/${created.token}`, { answers: data, currentStep, sendResumeLink: true });
        } else {
          await patch(`/configurator/drafts/${tokenRef.current}`, { answers: data, currentStep, sendResumeLink: opts.sendResumeLink });
        }
        dirty.current = false;
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    },
    [],
  );

  useEffect(() => {
    if (loadingDraft || !dirty.current) return;
    const t = setTimeout(() => void save(answers, step), 900);
    return () => clearTimeout(t);
  }, [answers, step, save, loadingDraft]);

  useEffect(() => {
    const onLeave = () => {
      if (dirty.current) trackEvent("configurator_abandoned", { properties: { step: CONFIGURATOR_STEPS[step].key } });
    };
    window.addEventListener("pagehide", onLeave);
    return () => window.removeEventListener("pagehide", onLeave);
  }, [step]);

  const update = <K extends keyof Answers>(section: K, patchValue: Partial<NonNullable<Answers[K]>>) => {
    dirty.current = true;
    setAnswers((a) => ({ ...a, [section]: { ...(a[section] as object), ...patchValue } }));
  };

  // ---------------------------------------------------------------- navigation & validation
  const stepKey = CONFIGURATOR_STEPS[step].key;
  function validateStep(key: ConfiguratorStepKey): boolean {
    const schema = STEP_SCHEMAS[key];
    const r = schema.safeParse((answers as Record<string, unknown>)[key] ?? {});
    if (r.success) {
      setErrors({});
      return true;
    }
    const errs: Record<string, string> = {};
    for (const i of r.error.issues) errs[i.path.join(".")] ??= i.message;
    setErrors(errs);
    return false;
  }
  function go(to: number) {
    setStep(to);
    setErrors({});
    void save(answers, to);
    requestAnimationFrame(() => {
      headingRef.current?.focus();
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }
  function next() {
    if (!validateStep(stepKey)) return;
    trackEvent("configurator_step_completed", { properties: { step: stepKey } });
    go(Math.min(step + 1, CONFIGURATOR_STEPS.length - 1));
  }

  async function submit() {
    for (const [i, s] of CONFIGURATOR_STEPS.entries()) {
      if (!validateStep(s.key)) {
        setStep(i);
        return;
      }
    }
    setSubmitting(true);
    setSubmitError(null);
    let idem: string;
    try {
      idem = localStorage.getItem(IDEM_KEY) ?? newIdempotencyKey("brief");
      localStorage.setItem(IDEM_KEY, idem);
    } catch {
      idem = newIdempotencyKey("brief");
    }
    try {
      const res = await post<EstimateView>("/configurator/submissions", { answers, draftToken: token ?? undefined, idempotencyKey: idem, attribution: attribution() });
      writeToken(null);
      try {
        localStorage.removeItem(IDEM_KEY);
      } catch {
        /* ignore */
      }
      navigate(`/estimate/${res.submissionReference}?token=${res.accessToken}&new=1`);
    } catch (e) {
      setSubmitError(errorMessage(e));
      const fe = fieldErrors(e);
      if (Object.keys(fe).length) setErrors(fe);
    } finally {
      setSubmitting(false);
    }
  }

  async function emailResumeLink() {
    if (!answers.context?.email) {
      setErrors({ email: "Add your email on the first step to receive a link." });
      return;
    }
    await save(answers, step, { sendResumeLink: true });
    setResumeSent(true);
  }

  // ---------------------------------------------------------------- render
  if (schemaQ.isLoading || loadingDraft) return <PageShell title="Configure a project"><LoadingState full label="Preparing the configurator…" /></PageShell>;
  if (schemaQ.error || !schemaQ.data) return <PageShell title="Configure a project"><div className="pt-32"><ErrorState error={schemaQ.error} retry={() => void schemaQ.refetch()} /></div></PageShell>;
  const schema = schemaQ.data;
  if (!schema.enabled) {
    return (
      <PageShell title="Configure a project">
        <div className="pt-32 pb-24">
          <Container>
            <Alert tone="info" title="The configurator is temporarily unavailable">Please <Link href="/contact" className="underline">contact us</Link> and we'll get back to you within two working days.</Alert>
          </Container>
        </div>
      </PageShell>
    );
  }

  const err = (path: string) => errors[path] ?? null;
  const stepProps = { answers, update, schema, err };

  return (
    <PageShell title="Configure a project" description="Describe your problem in plain language and get an indicative assessment: recommended solution, cost range, timeline and payment plan.">
      <section className="pt-28 pb-24">
        <Container>
          <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-10 lg:gap-16">
            {/* Progress */}
            <nav aria-label="Configurator progress" className="lg:sticky lg:top-28 self-start">
              <div className="lg:hidden">
                <div className="flex justify-between text-[13px] text-muted mb-2">
                  <span>Step {step + 1} of {CONFIGURATOR_STEPS.length}</span>
                  <SaveIndicator state={saveState} />
                </div>
                <div className="h-1 bg-ink/10 rounded-full overflow-hidden" role="progressbar" aria-valuenow={step + 1} aria-valuemin={1} aria-valuemax={CONFIGURATOR_STEPS.length} aria-label="Progress">
                  <div className="h-full bg-ink transition-all" style={{ width: `${((step + 1) / CONFIGURATOR_STEPS.length) * 100}%` }} />
                </div>
              </div>
              <ol className="hidden lg:block space-y-1">
                {CONFIGURATOR_STEPS.map((s, i) => (
                  <li key={s.key}>
                    <button
                      type="button"
                      onClick={() => i < step && go(i)}
                      disabled={i > step}
                      aria-current={i === step ? "step" : undefined}
                      className={`w-full flex items-center gap-3 text-left py-2 text-[14px] ${i === step ? "text-ink font-medium" : i < step ? "text-ink hover:text-accent" : "text-faint cursor-default"}`}
                    >
                      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${i < step ? "bg-ink border-ink text-paper" : i === step ? "border-ink" : "border-rule"}`}>{i < step ? <Check size={12} /> : i + 1}</span>
                      {s.label}
                    </button>
                  </li>
                ))}
              </ol>
              <div className="hidden lg:block mt-6 pt-6 border-t hairline space-y-3">
                <SaveIndicator state={saveState} />
                <button type="button" onClick={emailResumeLink} className="flex items-center gap-2 text-[13px] text-ink underline underline-offset-4 hover:text-accent">
                  <Mail size={14} /> Email me a link to finish later
                </button>
                {resumeSent && <p className="text-[12px] text-muted">Sent — check your inbox.</p>}
              </div>
            </nav>

            {/* Step */}
            <div className="min-w-0 max-w-[760px]">
              {schema.demoPricing && step === CONFIGURATOR_STEPS.length - 1 && (
                <Alert tone="warning" className="mb-6" title="Demonstration pricing">Estimates currently use placeholder pricing rules that have not been approved as an Operandis rate card.</Alert>
              )}
              <div className="text-[12px] font-medium uppercase tracking-wider text-faint mb-3">Configure a project · Step {step + 1} of {CONFIGURATOR_STEPS.length}</div>
              <h1 ref={headingRef} tabIndex={-1} className="font-serif text-[32px] md:text-[44px] font-semibold text-ink leading-tight focus:outline-none">
                {STEP_TITLES[stepKey]}
              </h1>
              <p className="text-[16px] text-muted mt-3 leading-relaxed max-w-[640px]">{STEP_INTROS[stepKey]}</p>

              <div className="mt-10">
                {stepKey === "context" && <ContextStep {...stepProps} />}
                {stepKey === "problem" && <ProblemStep {...stepProps} />}
                {stepKey === "solution" && <SolutionStep {...stepProps} />}
                {stepKey === "users" && <UsersStep {...stepProps} />}
                {stepKey === "capabilities" && <CapabilitiesStep {...stepProps} />}
                {stepKey === "integrations" && <IntegrationsStep {...stepProps} />}
                {stepKey === "platforms" && <PlatformsStep {...stepProps} />}
                {stepKey === "migration" && <MigrationStep {...stepProps} />}
                {stepKey === "budget" && <BudgetStep {...stepProps} />}
                {stepKey === "review" && <ReviewStep {...stepProps} goTo={go} />}
              </div>

              {Object.keys(errors).length > 0 && stepKey !== "review" && (
                <Alert tone="danger" className="mt-8">Please check the highlighted answers before continuing.</Alert>
              )}
              {submitError && <Alert tone="danger" className="mt-8" title="We couldn't submit your brief">{submitError}</Alert>}

              <div className="mt-10 pt-6 border-t hairline flex flex-col-reverse sm:flex-row sm:items-center sm:justify-between gap-4">
                <Btn variant="ghost" onClick={() => go(step - 1)} disabled={step === 0}>
                  <ArrowLeft size={14} /> Back
                </Btn>
                {stepKey === "review" ? (
                  <Btn size="lg" loading={submitting} onClick={submit} disabled={!answers.review?.consentProcessing}>
                    Get my assessment
                  </Btn>
                ) : (
                  <Btn size="lg" onClick={next}>
                    Continue <ArrowRight size={14} />
                  </Btn>
                )}
              </div>
              <div className="lg:hidden mt-6">
                <button type="button" onClick={emailResumeLink} className="flex items-center gap-2 text-[13px] text-ink underline underline-offset-4">
                  <Mail size={14} /> Email me a link to finish later
                </button>
                {resumeSent && <p className="text-[12px] text-muted mt-1">Sent — check your inbox.</p>}
              </div>
            </div>
          </div>
        </Container>
      </section>
    </PageShell>
  );
}

function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12px] text-muted" aria-live="polite">
      {state === "saving" && <><Loader2 size={12} className="animate-spin" /> Saving…</>}
      {state === "saved" && <><Check size={12} /> Saved</>}
      {state === "error" && <><CloudOff size={12} /> Not saved — we'll retry</>}
      {state === "idle" && <>Answers save automatically</>}
    </span>
  );
}

const STEP_TITLES: Record<ConfiguratorStepKey, string> = {
  context: "Tell us about you",
  problem: "What problem are you solving?",
  solution: "What kind of software might help?",
  users: "Who will use it?",
  capabilities: "What should it do?",
  integrations: "What does it need to connect to?",
  platforms: "Where will people use it?",
  migration: "What exists today?",
  budget: "Budget and timing",
  review: "Review your brief",
};
const STEP_INTROS: Record<ConfiguratorStepKey, string> = {
  context: "So we know who we're helping. We only use these details to respond to your brief.",
  problem: "Plain language is perfect — no technical terms needed. What's going wrong, and what would better look like?",
  solution: "Pick everything that sounds right. If you're not sure, choose “Not sure yet” and we'll recommend the right shape.",
  users: "Rough numbers are fine; they help us size the system.",
  capabilities: "Choose the capabilities you know you'll need. Some depend on others — we'll add those for you.",
  integrations: "List the tools it must talk to. Not sure if they have an API? That's fine — tell us what you know.",
  platforms: "Most projects start on the web. Native apps add app-store, device and release work.",
  migration: "Moving existing data or content changes the effort, so we ask up front.",
  budget: "This helps us recommend the right starting point. “Not sure” is a perfectly good answer.",
  review: "Check everything looks right. You'll get an indicative, non-binding assessment straight away.",
};

interface StepProps {
  answers: Answers;
  update: <K extends keyof Answers>(section: K, patch: Partial<NonNullable<Answers[K]>>) => void;
  schema: Schema;
  err: (path: string) => string | null;
}

function ContextStep({ answers, update, err }: StepProps) {
  const c = answers.context ?? {};
  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-[13px] font-medium text-ink mb-2">Are you…</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3" role="radiogroup">
          <ChoiceCard type="radio" name="clientType" selected={c.clientType === "company"} onToggle={() => update("context", { clientType: "company" })} title="A business or organisation" />
          <ChoiceCard type="radio" name="clientType" selected={c.clientType === "individual"} onToggle={() => update("context", { clientType: "individual" })} title="An individual or founder" />
        </div>
      </fieldset>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <TextField label="Your name" required autoComplete="name" value={c.name ?? ""} onChange={(e) => update("context", { name: e.target.value })} error={err("name")} />
        <TextField label="Email" type="email" required autoComplete="email" value={c.email ?? ""} onChange={(e) => update("context", { email: e.target.value })} error={err("email")} />
        <TextField label="Phone (optional)" type="tel" autoComplete="tel" value={c.phone ?? ""} onChange={(e) => update("context", { phone: e.target.value })} error={err("phone")} />
        {c.clientType !== "individual" && <TextField label="Company" autoComplete="organization" value={c.company ?? ""} onChange={(e) => update("context", { company: e.target.value })} />}
        {c.clientType !== "individual" && <TextField label="Your role (optional)" autoComplete="organization-title" value={c.role ?? ""} onChange={(e) => update("context", { role: e.target.value })} />}
        <TextField label="Industry (optional)" value={c.industry ?? ""} onChange={(e) => update("context", { industry: e.target.value })} placeholder="e.g. Logistics, retail, healthcare" />
      </div>
      <SelectField label="Country" value={c.country ?? "ZA"} onChange={(e) => update("context", { country: e.target.value })} options={[{ value: "ZA", label: "South Africa" }, { value: "BW", label: "Botswana" }, { value: "NA", label: "Namibia" }, { value: "KE", label: "Kenya" }, { value: "NG", label: "Nigeria" }, { value: "GB", label: "United Kingdom" }, { value: "US", label: "United States" }, { value: "OT", label: "Other" }]} className="max-w-[320px]" />
    </div>
  );
}

function ProblemStep({ answers, update, err }: StepProps) {
  const p = answers.problem ?? {};
  return (
    <div className="space-y-6">
      <TextArea label="Describe the problem" required rows={6} value={p.description ?? ""} onChange={(e) => update("problem", { description: e.target.value })} error={err("description")} hint={`${(p.description ?? "").length} characters — a few sentences is ideal.`} />
      <div>
        <p className="text-[13px] text-muted mb-2">Need a nudge? Start from an example:</p>
        <div className="flex flex-wrap gap-2">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => update("problem", { description: ex })} className="text-left text-[13px] border border-rule rounded-sm px-3 py-2 text-ink hover:border-ink max-w-[360px]">
              {ex}
            </button>
          ))}
        </div>
      </div>
      <TextArea label="What do you use today? (optional)" rows={3} value={p.currentTools ?? ""} onChange={(e) => update("problem", { currentTools: e.target.value })} placeholder="Spreadsheets, WhatsApp groups, an old system…" />
      <TextArea label="What would success look like? (optional)" rows={3} value={p.successLooksLike ?? ""} onChange={(e) => update("problem", { successLooksLike: e.target.value })} placeholder="e.g. orders processed same day, no double bookings" />
    </div>
  );
}

function SolutionStep({ answers, update, schema, err }: StepProps) {
  const types = answers.solution?.types ?? [];
  const toggle = (k: string) => {
    let next = types.includes(k) ? types.filter((t) => t !== k) : [...types, k];
    if (k === "unsure" && next.includes("unsure")) next = ["unsure"];
    else next = next.filter((t) => t !== "unsure" || k === "unsure");
    update("solution", { types: next });
  };
  return (
    <fieldset>
      <legend className="sr-only">Solution types</legend>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {schema.solutions.map((s) => (
          <ChoiceCard key={s.key} selected={types.includes(s.key)} onToggle={() => toggle(s.key)} title={s.label} description={<>{s.description}{s.examples.length > 0 && <span className="block mt-1 text-faint">e.g. {s.examples.join(", ")}</span>}</>} />
        ))}
      </div>
      {err("types") && <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">{err("types")}</p>}
    </fieldset>
  );
}

function UsersStep({ answers, update, schema, err }: StepProps) {
  const u = answers.users ?? {};
  const opts = (l: Opt[]) => l.map((o) => ({ value: o.key, label: o.label }));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <SelectField label="Your team members using it" required placeholder="Choose…" options={opts(schema.internalUserBands)} value={u.internalBand ?? ""} onChange={(e) => update("users", { internalBand: e.target.value })} error={err("internalBand")} />
      <SelectField label="Customers or external users" required placeholder="Choose…" options={opts(schema.customerUserBands)} value={u.customerBand ?? ""} onChange={(e) => update("users", { customerBand: e.target.value })} error={err("customerBand")} />
      <SelectField label="Different types of user" required placeholder="Choose…" options={opts(schema.roleBands)} value={u.roleBand ?? ""} onChange={(e) => update("users", { roleBand: e.target.value })} error={err("roleBand")} hint="e.g. admin, staff, customer, supplier" />
      <TextArea label="Anything about how they'll use it? (optional)" rows={3} className="sm:col-span-2" value={u.notes ?? ""} onChange={(e) => update("users", { notes: e.target.value })} />
    </div>
  );
}

function CapabilitiesStep({ answers, update, schema }: StepProps) {
  const selected = answers.capabilities?.features ?? [];
  const solutions = (answers.solution?.types ?? []).filter((t) => t !== "unsure");
  const visible = schema.features.filter((f) => f.solutions.length === 0 || solutions.length === 0 || f.solutions.some((s) => solutions.includes(s)));
  const label = (k: string) => schema.features.find((f) => f.key === k)?.label ?? k;
  const toggle = (key: string) => {
    let next: string[];
    if (selected.includes(key)) {
      // Removing a feature also removes anything that depends on it.
      const removeSet = new Set([key]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const f of schema.features) if (selected.includes(f.key) && !removeSet.has(f.key) && f.requires.some((r) => removeSet.has(r))) {
          removeSet.add(f.key);
          changed = true;
        }
      }
      next = selected.filter((k) => !removeSet.has(k));
    } else {
      const add = new Set([key]);
      const queue = [key];
      while (queue.length) {
        const f = schema.features.find((x) => x.key === queue.pop());
        for (const r of f?.requires ?? []) if (!add.has(r)) {
          add.add(r);
          queue.push(r);
        }
      }
      next = [...new Set([...selected, ...add])];
    }
    update("capabilities", { features: next });
  };
  return (
    <div className="space-y-10">
      {schema.featureGroups.map((g) => {
        const items = visible.filter((f) => f.groupKey === g.key);
        if (!items.length) return null;
        return (
          <fieldset key={g.key}>
            <legend className="font-serif text-[20px] text-ink">{g.label}</legend>
            {g.description && <p className="text-[14px] text-muted mt-1 mb-4">{g.description}</p>}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {items.map((f) => (
                <ChoiceCard
                  key={f.key}
                  selected={selected.includes(f.key)}
                  onToggle={() => toggle(f.key)}
                  title={f.label}
                  badge={f.sensitive ? <Badge tone="warning">Needs review</Badge> : undefined}
                  description={<>{f.description}{f.requires.length > 0 && <span className="block mt-1 text-faint">Includes: {f.requires.map(label).join(", ")}</span>}</>}
                />
              ))}
            </div>
          </fieldset>
        );
      })}
      <TextArea label="Anything else it must do? (optional)" rows={3} value={answers.capabilities?.notes ?? ""} onChange={(e) => update("capabilities", { notes: e.target.value })} />
    </div>
  );
}

function IntegrationsStep({ answers, update, schema }: StepProps) {
  const items = answers.integrations?.items ?? [];
  const find = (k: string) => items.find((i) => i.key === k);
  const setItem = (k: string, patchValue: Partial<(typeof items)[number]> | null) => {
    const others = items.filter((i) => i.key !== k);
    update("integrations", { items: patchValue === null ? others : [...others, { key: k, vendor: "", apiAvailable: "unknown", ...find(k), ...patchValue }] });
  };
  return (
    <div className="space-y-3">
      {schema.integrations.map((it) => {
        const sel = find(it.key);
        return (
          <div key={it.key} className={`border rounded-sm bg-white ${sel ? "border-ink" : "border-rule"}`}>
            <Checkbox className="p-4" checked={Boolean(sel)} onChange={(e) => setItem(it.key, e.target.checked ? {} : null)} label={<span className="font-medium">{it.label}</span>} hint={it.examples.length ? `e.g. ${it.examples.join(", ")}` : undefined} />
            {sel && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 px-4 pb-4 pl-11">
                <TextField label="Which product/vendor?" value={sel.vendor ?? ""} onChange={(e) => setItem(it.key, { vendor: e.target.value })} placeholder={it.examples[0] ?? ""} />
                <SelectField label="Does it have an API?" value={sel.apiAvailable ?? "unknown"} onChange={(e) => setItem(it.key, { apiAvailable: e.target.value as "yes" | "no" | "unknown" })} options={[{ value: "yes", label: "Yes, documented" }, { value: "unknown", label: "Not sure" }, { value: "no", label: "No / legacy system" }]} />
              </div>
            )}
          </div>
        );
      })}
      <TextArea label="Other systems (optional)" className="pt-4" rows={2} value={answers.integrations?.other ?? ""} onChange={(e) => update("integrations", { other: e.target.value })} />
    </div>
  );
}

function PlatformsStep({ answers, update, schema, err }: StepProps) {
  const platforms = answers.platforms?.platforms ?? [];
  const toggle = (k: string) => update("platforms", { platforms: platforms.includes(k) ? platforms.filter((p) => p !== k) : [...platforms, k] });
  const native = platforms.some((p) => schema.platforms.find((x) => x.key === p)?.native);
  return (
    <div className="space-y-10">
      <fieldset>
        <legend className="font-serif text-[20px] text-ink mb-4">Platforms</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {schema.platforms.map((p) => (
            <ChoiceCard key={p.key} selected={platforms.includes(p.key)} onToggle={() => toggle(p.key)} title={p.label} description={p.description} badge={p.native ? <Badge tone="warning">Native</Badge> : undefined} />
          ))}
        </div>
        {err("platforms") && <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">{err("platforms")}</p>}
        {native && <Alert tone="info" className="mt-4">Native apps need app-store accounts, device testing and a release process for every update. A mobile-friendly web app (PWA) is often enough to start — we'll advise.</Alert>}
      </fieldset>
      <fieldset>
        <legend className="font-serif text-[20px] text-ink mb-4">Branding & design readiness</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {schema.brandingReadiness.map((b) => (
            <ChoiceCard key={b.key} type="radio" name="branding" selected={answers.platforms?.branding === b.key} onToggle={() => update("platforms", { branding: b.key })} title={b.label} />
          ))}
        </div>
        {err("branding") && <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">Choose one option.</p>}
      </fieldset>
    </div>
  );
}

function MigrationStep({ answers, update, schema, err }: StepProps) {
  const m = answers.migration ?? {};
  return (
    <div className="space-y-8">
      <fieldset>
        <legend className="font-serif text-[20px] text-ink mb-4">Existing data or system</legend>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {schema.migrationLevels.map((l) => (
            <ChoiceCard key={l.key} type="radio" name="migration" selected={m.level === l.key} onToggle={() => update("migration", { level: l.key })} title={l.label} />
          ))}
        </div>
        {err("level") && <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">Choose one option.</p>}
      </fieldset>
      {m.level && m.level !== "none" && (
        <>
          <TextArea label="What exists today? (optional)" rows={3} value={m.existingSystems ?? ""} onChange={(e) => update("migration", { existingSystems: e.target.value })} placeholder="e.g. 8 000 customer records in Excel; an old Access database" />
          <Checkbox checked={m.sourceOwnershipKnown ?? true} onChange={(e) => update("migration", { sourceOwnershipKnown: e.target.checked })} label="We own the existing data and can export it" hint="Untick if access depends on a vendor or ex-supplier." />
        </>
      )}
      <SelectField label="Is your content (text, images, product data) ready?" value={m.contentReady ?? "partial"} onChange={(e) => update("migration", { contentReady: e.target.value as "yes" | "partial" | "no" })} options={[{ value: "yes", label: "Yes, ready" }, { value: "partial", label: "Partly" }, { value: "no", label: "Not yet" }]} className="max-w-[360px]" />
      <Checkbox checked={m.hasDomainHosting ?? false} onChange={(e) => update("migration", { hasDomainHosting: e.target.checked })} label="We already have a domain name and hosting" />
    </div>
  );
}

function BudgetStep({ answers, update, schema, err }: StepProps) {
  const b = answers.budget ?? {};
  return (
    <div className="space-y-10">
      <fieldset>
        <legend className="font-serif text-[20px] text-ink mb-4">Approximate budget</legend>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {schema.budgetBands.map((o) => (
            <ChoiceCard key={o.key} type="radio" name="budget" selected={b.budgetBand === o.key} onToggle={() => update("budget", { budgetBand: o.key })} title={o.label} />
          ))}
        </div>
        {err("budgetBand") && <p role="alert" className="text-[13px] text-[#9F1D1D] mt-3">Choose a budget band (or “Not sure yet”).</p>}
      </fieldset>
      <SelectField label="When would you like to launch?" required placeholder="Choose…" options={schema.launchTargets.map((o) => ({ value: o.key, label: o.label }))} value={b.launchTarget ?? ""} onChange={(e) => update("budget", { launchTarget: e.target.value })} error={err("launchTarget")} className="max-w-[420px]" />
      <fieldset>
        <legend className="font-serif text-[20px] text-ink mb-4">How urgent is it?</legend>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {schema.urgency.map((o) => (
            <ChoiceCard key={o.key} type="radio" name="urgency" selected={b.urgency === o.key} onToggle={() => update("budget", { urgency: o.key })} title={o.label} description={o.description} />
          ))}
        </div>
      </fieldset>
      <TextArea label="Anything about budget or timing? (optional)" rows={2} value={b.notes ?? ""} onChange={(e) => update("budget", { notes: e.target.value })} />
    </div>
  );
}

function ReviewStep({ answers, update, schema, goTo }: StepProps & { goTo: (i: number) => void }) {
  const label = (list: Opt[], k?: string) => list.find((o) => o.key === k)?.label ?? "—";
  const many = (list: Opt[], ks: string[] = []) => (ks.length ? ks.map((k) => label(list, k)).join(", ") : "None selected");
  const sections: { step: number; title: string; rows: [string, string][] }[] = useMemo(
    () => [
      { step: 0, title: "About you", rows: [["Name", answers.context?.name ?? "—"], ["Email", answers.context?.email ?? "—"], ["Company", answers.context?.company || "—"]] },
      { step: 1, title: "The problem", rows: [["Description", answers.problem?.description ?? "—"]] },
      { step: 2, title: "Solution type", rows: [["Selected", many(schema.solutions, answers.solution?.types)]] },
      { step: 3, title: "Users", rows: [["Team", label(schema.internalUserBands, answers.users?.internalBand)], ["Customers", label(schema.customerUserBands, answers.users?.customerBand)], ["Roles", label(schema.roleBands, answers.users?.roleBand)]] },
      { step: 4, title: "Capabilities", rows: [["Selected", many(schema.features, answers.capabilities?.features)]] },
      { step: 5, title: "Integrations", rows: [["Selected", (answers.integrations?.items ?? []).map((i) => `${label(schema.integrations, i.key)}${i.vendor ? ` (${i.vendor})` : ""}`).join(", ") || "None"]] },
      { step: 6, title: "Platforms & design", rows: [["Platforms", many(schema.platforms, answers.platforms?.platforms)], ["Branding", label(schema.brandingReadiness, answers.platforms?.branding)]] },
      { step: 7, title: "Existing data", rows: [["Migration", label(schema.migrationLevels, answers.migration?.level)]] },
      { step: 8, title: "Budget & timing", rows: [["Budget", label(schema.budgetBands, answers.budget?.budgetBand)], ["Launch", label(schema.launchTargets, answers.budget?.launchTarget)], ["Urgency", label(schema.urgency, answers.budget?.urgency)]] },
    ],
    [answers, schema],
  );
  return (
    <div className="space-y-8">
      <div className="divide-y hairline border-y hairline">
        {sections.map((s) => (
          <div key={s.title} className="py-5 flex flex-col sm:flex-row sm:items-start gap-3">
            <div className="sm:w-[180px] shrink-0 font-serif text-[17px] text-ink">{s.title}</div>
            <dl className="flex-1 space-y-1 text-[14px] min-w-0">
              {s.rows.map(([k, v]) => (
                <div key={k} className="flex gap-3">
                  <dt className="text-muted w-[90px] shrink-0">{k}</dt>
                  <dd className="text-ink break-words min-w-0">{v}</dd>
                </div>
              ))}
            </dl>
            <button type="button" onClick={() => goTo(s.step)} className="inline-flex items-center gap-1 text-[13px] text-ink underline underline-offset-4 hover:text-accent self-start">
              <Pencil size={12} /> Edit <span className="sr-only">{s.title}</span>
            </button>
          </div>
        ))}
      </div>
      <SelectField label="How should we contact you?" value={answers.review?.contactPreference ?? "email"} onChange={(e) => update("review", { contactPreference: e.target.value as "email" | "phone" | "whatsapp" })} options={[{ value: "email", label: "Email" }, { value: "phone", label: "Phone call" }, { value: "whatsapp", label: "WhatsApp" }]} className="max-w-[320px]" />
      <div className="space-y-3">
        <Checkbox checked={Boolean(answers.review?.consentProcessing)} onChange={(e) => update("review", { consentProcessing: e.target.checked })} label={<>I consent to Operandis processing this brief to prepare an assessment and contact me about it, as described in the <Link href="/privacy" className="underline">Privacy Policy</Link>.</>} />
        <Checkbox checked={Boolean(answers.review?.consentMarketing)} onChange={(e) => update("review", { consentMarketing: e.target.checked })} label="Send me occasional updates and insights (optional)." />
      </div>
      <p className="text-[13px] text-muted leading-relaxed">
        Your assessment is calculated on our server from published pricing rules. It's indicative and non-binding until discovery and a written proposal.
      </p>
    </div>
  );
}
