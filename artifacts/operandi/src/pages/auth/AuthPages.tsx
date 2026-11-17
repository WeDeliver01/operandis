import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import type { Me } from "@workspace/api-zod";
import { PageShell } from "@/components/PageShell";
import { Container } from "@/components/Container";
import { post, errorMessage, fieldErrors, problemOf } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Alert, Btn, TextField } from "@/components/ui-kit";
import { LoadingState } from "@/components/ui-kit/states";

/** Only allow same-site relative redirects (prevents open redirects). */
export function safeNext(next: string | null, fallback: string): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return fallback;
  return next;
}

function AuthFrame({ title, intro, children, footer }: { title: string; intro?: ReactNode; children: ReactNode; footer?: ReactNode }) {
  return (
    <PageShell title={title}>
      <section className="pt-32 pb-24">
        <Container>
          <div className="max-w-[440px] mx-auto">
            <h1 className="font-serif text-[36px] font-semibold text-ink">{title}</h1>
            {intro && <p className="text-muted mt-2 leading-relaxed">{intro}</p>}
            <div className="mt-8">{children}</div>
            {footer && <div className="mt-8 pt-6 border-t hairline text-[14px] text-muted space-y-2">{footer}</div>}
          </div>
        </Container>
      </section>
    </PageShell>
  );
}

export function Login() {
  const search = new URLSearchParams(useSearch());
  const next = search.get("next");
  const [, navigate] = useLocation();
  const { me: current, setMe } = useAuth();
  useEffect(() => {
    if (current) navigate(safeNext(next, current.role === "client" ? "/portal" : "/admin"), { replace: true });
  }, [current]); // eslint-disable-line react-hooks/exhaustive-deps
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needMfa, setNeedMfa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [magicSent, setMagicSent] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await post<Me>("/auth/login", { email, password, mfaCode: needMfa ? mfaCode : undefined });
      setMe(me);
    } catch (err) {
      if (problemOf(err)?.code === "mfa_required") {
        setNeedMfa(true);
        setError(null);
      } else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  async function magic() {
    if (!email) {
      setError("Enter your email address first.");
      return;
    }
    setBusy(true);
    try {
      await post("/auth/magic-link", { email });
      setMagicSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame
      title="Sign in"
      intro="Access your client portal or the Operandis console."
      footer={
        <>
          <p>New here? <Link href={`/register${next ? `?next=${encodeURIComponent(next)}` : ""}`} className="underline text-ink">Create an account</Link></p>
          <p><Link href="/auth/forgot" className="underline text-ink">Forgot your password?</Link></p>
        </>
      }
    >
      {magicSent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for {email}, we've sent a one-time sign-in link. It expires in 30 minutes.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <TextField label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          {needMfa && <TextField label="Authenticator code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={mfaCode} onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, ""))} hint="Enter the 6-digit code from your authenticator app." autoFocus />}
          {error && <Alert tone="danger">{error}</Alert>}
          <Btn type="submit" size="lg" className="w-full" loading={busy}>Sign in</Btn>
          <Btn variant="ghost" className="w-full" onClick={magic} disabled={busy}>Email me a sign-in link instead</Btn>
        </form>
      )}
    </AuthFrame>
  );
}

export function Register() {
  const search = new URLSearchParams(useSearch());
  const next = search.get("next");
  const [, navigate] = useLocation();
  const { refresh } = useAuth();
  const [form, setForm] = useState({ name: "", email: "", company: "", password: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [checkEmail, setCheckEmail] = useState(false);
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm({ ...form, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setErrors({});
    try {
      const r = await post<{ status: "created" | "check_email" }>("/auth/register", { ...form, company: form.company || undefined });
      if (r.status === "check_email") setCheckEmail(true);
      else {
        await refresh();
        navigate(safeNext(next, "/portal"));
      }
    } catch (err) {
      setErrors(fieldErrors(err));
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <AuthFrame title="Create your account" intro="Track projects, review proposals, pay invoices and download deliverables." footer={<p>Already have an account? <Link href="/login" className="underline text-ink">Sign in</Link></p>}>
      {checkEmail ? (
        <Alert tone="info" title="Check your inbox">We've sent a sign-in link to {form.email}. If you already had an account with us (for example from a previous purchase), use that link to access it.</Alert>
      ) : (
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField label="Full name" autoComplete="name" required value={form.name} onChange={set("name")} error={errors.name} />
          <TextField label="Email" type="email" autoComplete="email" required value={form.email} onChange={set("email")} error={errors.email} />
          <TextField label="Company (optional)" autoComplete="organization" value={form.company} onChange={set("company")} />
          <TextField label="Password" type="password" autoComplete="new-password" required value={form.password} onChange={set("password")} error={errors.password} hint="At least 10 characters, including a number." />
          {error && !Object.keys(errors).length && <Alert tone="danger">{error}</Alert>}
          <Btn type="submit" size="lg" className="w-full" loading={busy}>Create account</Btn>
          <p className="text-[12px] text-muted">By creating an account you agree to our <Link href="/terms" className="underline">Terms</Link> and <Link href="/privacy" className="underline">Privacy Policy</Link>.</p>
        </form>
      )}
    </AuthFrame>
  );
}

function useTokenAction(path: string, body: (token: string) => Record<string, unknown>) {
  const token = new URLSearchParams(useSearch()).get("token") ?? "";
  const [state, setState] = useState<{ status: "working" | "ok" | "error"; error?: string; data?: unknown }>({ status: "working" });
  const ran = useRef(false);
  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    if (!token) {
      setState({ status: "error", error: "This link is incomplete." });
      return;
    }
    post(path, body(token))
      .then((data) => setState({ status: "ok", data }))
      .catch((e) => setState({ status: "error", error: errorMessage(e) }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return state;
}

export function VerifyEmail() {
  const { refresh } = useAuth();
  const state = useTokenAction("/auth/verify-email", (token) => ({ token }));
  useEffect(() => {
    if (state.status === "ok") void refresh();
  }, [state.status, refresh]);
  return (
    <AuthFrame title="Confirm your email">
      {state.status === "working" ? <LoadingState /> : state.status === "ok" ? <Alert tone="success" title="Email confirmed">Your client portal is ready. <Link href="/portal" className="underline">Go to the portal</Link></Alert> : <Alert tone="danger">{state.error}</Alert>}
    </AuthFrame>
  );
}

export function MagicLink() {
  const search = new URLSearchParams(useSearch());
  const next = safeNext(search.get("next"), "/portal");
  const [, navigate] = useLocation();
  const { refresh } = useAuth();
  const state = useTokenAction("/auth/magic-link/consume", (token) => ({ token }));
  useEffect(() => {
    if (state.status === "ok") {
      void refresh().then(() => {
        const hasPassword = (state.data as { hasPassword?: boolean })?.hasPassword;
        navigate(hasPassword ? next : `/portal/profile?setPassword=1&next=${encodeURIComponent(next)}`);
      });
    }
  }, [state.status]); // eslint-disable-line react-hooks/exhaustive-deps
  return <AuthFrame title="Signing you in…">{state.status === "error" ? <Alert tone="danger">{state.error} <Link href="/login" className="underline">Request a new link</Link></Alert> : <LoadingState />}</AuthFrame>;
}

export function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthFrame title="Reset your password" footer={<p><Link href="/login" className="underline text-ink">Back to sign in</Link></p>}>
      {sent ? (
        <Alert tone="success" title="Check your inbox">If an account exists for {email}, a reset link is on its way. It expires in one hour.</Alert>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              await post("/auth/forgot-password", { email });
              setSent(true);
            } catch (err) {
              setError(errorMessage(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <TextField label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          {error && <Alert tone="danger">{error}</Alert>}
          <Btn type="submit" size="lg" className="w-full" loading={busy}>Send reset link</Btn>
        </form>
      )}
    </AuthFrame>
  );
}

export function ResetPassword() {
  const search = new URLSearchParams(useSearch());
  const token = search.get("token") ?? "";
  const invite = search.get("invite") === "1";
  const [, navigate] = useLocation();
  const { refresh } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <AuthFrame title={invite ? "Set up your account" : "Choose a new password"}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== confirm) {
            setError("The passwords don't match.");
            return;
          }
          setBusy(true);
          setError(null);
          try {
            await post("/auth/reset-password", { token, password });
            await refresh();
            navigate("/portal");
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <TextField label="New password" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} hint="At least 10 characters, including a number." />
        <TextField label="Confirm password" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {error && <Alert tone="danger">{error}</Alert>}
        <Btn type="submit" size="lg" className="w-full" loading={busy} disabled={!token}>Save password</Btn>
      </form>
    </AuthFrame>
  );
}

/** Staff step-up: enrol or verify TOTP before using the console. */
export function MfaChallenge() {
  const search = new URLSearchParams(useSearch());
  const next = safeNext(search.get("next"), "/admin");
  const [, navigate] = useLocation();
  const { me, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return <AuthFrame title="Two-factor authentication"><LoadingState /></AuthFrame>;
  const enrolling = !me.mfaEnabled;
  return (
    <AuthFrame title="Two-factor authentication" intro={enrolling ? "Staff accounts must use an authenticator app (Google Authenticator, 1Password, Authy…)." : "Enter the current code from your authenticator app."}>
      <div className="space-y-4">
        {enrolling && !setup && (
          <Btn
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                setSetup(await post("/auth/mfa/setup"));
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Set up authenticator
          </Btn>
        )}
        {setup && (
          <div className="bg-white border hairline rounded-sm p-4 text-[14px]">
            <p className="text-muted">Add this key to your authenticator app (or open the link on your phone):</p>
            <p className="font-mono text-ink mt-2 break-all select-all">{setup.secret}</p>
            <a href={setup.otpauthUri} className="underline text-ink text-[13px] mt-2 inline-block">Open in authenticator app</a>
          </div>
        )}
        {(!enrolling || setup) && (
          <form
            className="space-y-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await post(enrolling ? "/auth/mfa/enable" : "/auth/mfa/verify", { code });
                await refresh();
                navigate(next);
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <TextField label="6-digit code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
            <Btn type="submit" loading={busy} className="w-full">Verify</Btn>
          </form>
        )}
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </AuthFrame>
  );
}
