import { forwardRef, useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { Link } from "wouter";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ buttons */
type Variant = "primary" | "secondary" | "ghost" | "danger" | "link";
type Size = "sm" | "md" | "lg";
const base =
  "inline-flex items-center justify-center gap-2 font-medium uppercase tracking-wider rounded-sm transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer";
const variants: Record<Variant, string> = {
  primary: "bg-ink text-paper hover:bg-accent",
  secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
  ghost: "text-ink hover:bg-ink/5 normal-case tracking-normal",
  danger: "bg-[#9F1D1D] text-white hover:bg-[#7F1717]",
  link: "text-ink underline underline-offset-4 hover:text-accent normal-case tracking-normal px-0 py-0",
};
const sizes: Record<Size, string> = { sm: "text-[12px] px-3 py-2", md: "text-[13px] px-5 py-3", lg: "text-[14px] px-7 py-4" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], variant === "link" ? "" : sizes[size], className);
}

export interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
}
export const Btn = forwardRef<HTMLButtonElement, BtnProps>(({ variant = "primary", size = "md", loading, className, children, disabled, ...props }, ref) => (
  <button ref={ref} type={props.type ?? "button"} className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <Loader2 size={14} className="animate-spin" aria-hidden />}
    {children}
  </button>
));
Btn.displayName = "Btn";

export function LinkBtn({ href, variant = "primary", size = "md", className, children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------ form fields */
interface FieldShell {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  className?: string;
}

function Shell({ id, label, hint, error, required, className, children }: FieldShell & { id: string; children: ReactNode }) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-[13px] font-medium text-ink">
        {label}
        {required && <span className="text-muted" aria-hidden> *</span>}
      </label>
      {children}
      {hint && !error && (
        <p id={`${id}-hint`} className="text-[12px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[12px] text-[#9F1D1D]">
          {error}
        </p>
      )}
    </div>
  );
}

const control =
  "w-full bg-white border border-rule rounded-sm px-3 py-2.5 text-[15px] text-ink placeholder:text-faint focus:outline-none focus:border-ink focus:ring-1 focus:ring-ink disabled:bg-paper disabled:text-muted aria-[invalid=true]:border-[#9F1D1D]";

export function TextField({ label, hint, error, required, className, ...props }: FieldShell & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <input id={id} required={required} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={control} {...props} />
    </Shell>
  );
}

export function TextArea({ label, hint, error, required, className, ...props }: FieldShell & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <textarea id={id} required={required} rows={props.rows ?? 4} aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : undefined} className={cn(control, "leading-relaxed")} {...props} />
    </Shell>
  );
}

export function SelectField({ label, hint, error, required, className, options, placeholder, ...props }: FieldShell & SelectHTMLAttributes<HTMLSelectElement> & { options: { value: string; label: string }[]; placeholder?: string }) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <Shell id={id} label={label} hint={hint} error={error} required={required} className={className}>
      <select id={id} required={required} aria-invalid={error ? true : undefined} className={cn(control, "appearance-auto")} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function Checkbox({ label, hint, error, className, ...props }: { label: ReactNode; hint?: ReactNode; error?: string | null; className?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const id = props.id ?? auto;
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="flex items-start gap-3 text-[14px] text-ink cursor-pointer">
        <input id={id} type="checkbox" className="mt-1 h-4 w-4 accent-[#0F1115] cursor-pointer" aria-invalid={error ? true : undefined} {...props} />
        <span>
          {label}
          {hint && <span className="block text-[12px] text-muted mt-0.5">{hint}</span>}
        </span>
      </label>
      {error && (
        <p role="alert" className="text-[12px] text-[#9F1D1D] ml-7">
          {error}
        </p>
      )}
    </div>
  );
}

/** Large selectable card used for single/multi choice questions. */
export function ChoiceCard({ selected, onToggle, title, description, type = "checkbox", name, disabled, badge }: { selected: boolean; onToggle: () => void; title: ReactNode; description?: ReactNode; type?: "checkbox" | "radio"; name?: string; disabled?: boolean; badge?: ReactNode }) {
  const id = useId();
  return (
    <label
      htmlFor={id}
      className={cn(
        "relative flex gap-3 border rounded-sm p-4 cursor-pointer transition-colors bg-white",
        selected ? "border-ink ring-1 ring-ink" : "border-rule hover:border-ink/40",
        disabled && "opacity-50 cursor-not-allowed",
      )}
    >
      <input id={id} type={type} name={name} checked={selected} onChange={onToggle} disabled={disabled} className="mt-1 h-4 w-4 accent-[#0F1115] shrink-0" />
      <span className="min-w-0">
        <span className="flex items-center gap-2 flex-wrap text-[15px] font-medium text-ink">
          {title}
          {badge}
        </span>
        {description && <span className="block text-[13px] text-muted mt-1 leading-relaxed">{description}</span>}
      </span>
    </label>
  );
}

/* ------------------------------------------------------------------ display */
const tones = {
  neutral: "bg-ink/5 text-ink border-ink/10",
  success: "bg-[#E8F3EC] text-[#1E6B3A] border-[#CDE5D5]",
  warning: "bg-[#FBF1E1] text-[#8A5A12] border-[#F1DDB8]",
  danger: "bg-[#FBE9E9] text-[#9F1D1D] border-[#F2CFCF]",
  info: "bg-[#EAF0F8] text-[#24508A] border-[#D2DFF0]",
  accent: "bg-accent/10 text-accent border-accent/20",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "neutral", children, className }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 border text-[11px] font-medium uppercase tracking-wider px-2 py-0.5 rounded-sm whitespace-nowrap", tones[tone], className)}>{children}</span>;
}

const STATUS_TONES: Record<string, Tone> = {
  new: "info",
  contacted: "neutral",
  qualified: "accent",
  discovery_proposed: "accent",
  proposal_sent: "info",
  won: "success",
  lost: "danger",
  nurture: "neutral",
  draft: "neutral",
  sent: "info",
  viewed: "info",
  accepted: "success",
  declined: "danger",
  superseded: "neutral",
  expired: "warning",
  withdrawn: "neutral",
  pending_payment: "warning",
  confirmed: "success",
  in_progress: "info",
  completed: "success",
  cancelled: "neutral",
  refunded: "neutral",
  partially_refunded: "warning",
  issued: "info",
  partially_paid: "warning",
  paid: "success",
  void: "neutral",
  overdue: "danger",
  created: "neutral",
  redirected: "neutral",
  pending_verification: "warning",
  succeeded: "success",
  failed: "danger",
  awaiting_deposit: "warning",
  not_started: "neutral",
  on_hold: "warning",
  in_review: "info",
  pending: "neutral",
  awaiting_approval: "warning",
  open: "info",
  triaged: "neutral",
  quoted: "warning",
  approved: "success",
  rejected: "danger",
  resolved: "success",
  closed: "neutral",
  submitted: "info",
  under_review: "warning",
  estimate_ready: "accent",
  converted: "success",
  published: "success",
  paused: "warning",
  archived: "neutral",
  active: "success",
  retired: "neutral",
  disabled: "danger",
  manual_pending: "warning",
  manual_completed: "success",
  processed: "success",
  ignored: "neutral",
  received: "neutral",
  queued: "neutral",
  skipped: "neutral",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONES[status] ?? "neutral"}>{label ?? status.replace(/_/g, " ")}</Badge>;
}

export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-[12px] font-medium uppercase tracking-wider text-faint", className)}>{children}</div>;
}

export function Card({ children, className, as: As = "div" }: { children: ReactNode; className?: string; as?: "div" | "section" | "article" }) {
  return <As className={cn("bg-white border hairline rounded-sm", className)}>{children}</As>;
}

export function CardHeader({ title, actions, description }: { title: ReactNode; actions?: ReactNode; description?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-4 border-b hairline">
      <div className="min-w-0">
        <h2 className="font-serif text-[18px] font-medium text-ink">{title}</h2>
        {description && <p className="text-[13px] text-muted mt-0.5">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, href }: { label: string; value: ReactNode; hint?: ReactNode; href?: string }) {
  const inner = (
    <>
      <div className="text-[12px] uppercase tracking-wider text-faint">{label}</div>
      <div className="font-serif text-[28px] text-ink mt-1 leading-tight">{value}</div>
      {hint && <div className="text-[12px] text-muted mt-1">{hint}</div>}
    </>
  );
  return href ? (
    <Link href={href} className="block bg-white border hairline rounded-sm p-5 hover:border-ink/40 transition-colors">
      {inner}
    </Link>
  ) : (
    <div className="bg-white border hairline rounded-sm p-5">{inner}</div>
  );
}

export function DefinitionList({ items, className }: { items: [ReactNode, ReactNode][]; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-1 sm:grid-cols-[max-content_1fr] gap-x-6 gap-y-2 text-[14px]", className)}>
      {items.map(([k, v], i) => (
        <div key={i} className="contents">
          <dt className="text-muted">{k}</dt>
          <dd className="text-ink min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Alert({ tone = "info", title, children, className }: { tone?: "info" | "warning" | "danger" | "success"; title?: ReactNode; children?: ReactNode; className?: string }) {
  const t = { info: tones.info, warning: tones.warning, danger: tones.danger, success: tones.success }[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cn("border rounded-sm px-4 py-3 text-[14px]", t, className)}>
      {title && <div className="font-medium">{title}</div>}
      {children && <div className={cn(title && "mt-1", "leading-relaxed")}>{children}</div>}
    </div>
  );
}
