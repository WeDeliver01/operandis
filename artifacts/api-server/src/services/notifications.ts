import { and, asc, eq, inArray, lt, or, isNull } from "drizzle-orm";
import { notifications, users, type Database, type DbOrTx } from "@workspace/db";
import { formatMoney } from "@workspace/domain";
import type { AppConfig } from "../config/env";
import type { Logger } from "../lib/logger";
import { renderEmailHtml, type EmailTransport } from "./email";
import type { SettingsService } from "./settings";

/**
 * Transactional notifications use an outbox: rows are inserted inside the
 * business transaction (so they exist iff the change committed) and a
 * dispatcher sends queued emails afterwards. `dedupeKey` makes duplicate
 * triggers (e.g. replayed webhooks) harmless.
 */

type Data = Record<string, unknown>;
interface Rendered {
  subject: string;
  heading: string;
  paragraphs: string[];
  cta?: { label: string; path: string };
}

const money = (v: unknown) => formatMoney(Number(v ?? 0), "ZAR", { decimals: true });
const s = (v: unknown) => String(v ?? "");

export const TEMPLATES: Record<string, (d: Data, brand: string) => Rendered> = {
  "auth.verify_email": (d, brand) => ({
    subject: `Confirm your email for ${brand}`,
    heading: "Confirm your email address",
    paragraphs: [`Hi ${s(d.name)}, please confirm this email address to activate your ${brand} client portal.`, "This link expires in 48 hours."],
    cta: { label: "Confirm email", path: s(d.path) },
  }),
  "auth.password_reset": (d) => ({
    subject: "Reset your password",
    heading: "Password reset requested",
    paragraphs: ["Someone (hopefully you) asked to reset the password for this account. The link expires in 1 hour.", "If this wasn't you, you can ignore this email — your password won't change."],
    cta: { label: "Choose a new password", path: s(d.path) },
  }),
  "auth.magic_link": (d, brand) => ({
    subject: `Your ${brand} sign-in link`,
    heading: "Sign in to your client portal",
    paragraphs: ["Use the button below to sign in. The link works once and expires in 30 minutes."],
    cta: { label: "Sign in", path: s(d.path) },
  }),
  "auth.invite": (d, brand) => ({
    subject: `You've been invited to ${brand}`,
    heading: "Set up your account",
    paragraphs: [`Hi ${s(d.name)}, an account has been created for you. Choose a password to get started. The link expires in 7 days.`],
    cta: { label: "Set password", path: s(d.path) },
  }),
  "configurator.resume_link": (d) => ({
    subject: "Continue your project brief",
    heading: "Pick up where you left off",
    paragraphs: ["Your answers are saved. Use this private link to continue your project brief at any time in the next 30 days. Don't share it — anyone with the link can see your answers."],
    cta: { label: "Continue my brief", path: s(d.path) },
  }),
  "configurator.received": (d) => ({
    subject: `We've received your brief (${s(d.reference)})`,
    heading: "Thanks — your brief is in",
    paragraphs: [
      `Reference ${s(d.reference)}. ${d.priced ? `Your indicative range is ${money(d.lowMinor)} – ${money(d.highMinor)}.` : "We'll review your answers and come back to you with a recommended next step."}`,
      "This estimate is indicative and non-binding until discovery and a written proposal. We'll be in touch within two working days.",
    ],
    cta: { label: "View your assessment", path: s(d.path) },
  }),
  "contact.received": (d) => ({
    subject: "We've received your message",
    heading: `Thanks, ${s(d.name)}`,
    paragraphs: ["We've received your message and will reply within two working days."],
  }),
  "staff.new_lead": (d) => ({
    subject: `New ${s(d.source)} lead: ${s(d.name)}${d.company ? ` (${s(d.company)})` : ""}`,
    heading: "New lead",
    paragraphs: [`${s(d.name)} <${s(d.email)}> — ${s(d.summary).slice(0, 400)}`, `Reference ${s(d.reference)}.${d.flags ? ` Review flags: ${s(d.flags)}` : ""}`],
    cta: { label: "Open in console", path: s(d.path) },
  }),
  "order.confirmed": (d) => ({
    subject: `Payment received — order ${s(d.orderReference)}`,
    heading: "Payment confirmed",
    paragraphs: [`We've received ${money(d.amountMinor)} for ${s(d.description)}. Your receipt (invoice ${s(d.invoiceNumber)}) is in your client portal.`, "We'll be in touch shortly to schedule kick-off."],
    cta: { label: "Open client portal", path: s(d.path) },
  }),
  "portal.access": (d, brand) => ({
    subject: `Access your ${brand} client portal`,
    heading: "Your client portal is ready",
    paragraphs: ["Track your project, invoices and files in one place. Use this link to sign in and set a password (valid for 7 days)."],
    cta: { label: "Open portal", path: s(d.path) },
  }),
  "invoice.issued": (d) => ({
    subject: `Invoice ${s(d.number)} — ${money(d.amountMinor)} due ${s(d.dueDate)}`,
    heading: `Invoice ${s(d.number)}`,
    paragraphs: [`An invoice for ${money(d.amountMinor)} (${s(d.description)}) has been issued and is due on ${s(d.dueDate)}.`],
    cta: { label: "View and pay", path: s(d.path) },
  }),
  "invoice.paid": (d) => ({
    subject: `Payment received for invoice ${s(d.number)}`,
    heading: "Thank you — payment received",
    paragraphs: [`We've received ${money(d.amountMinor)} against invoice ${s(d.number)}. Outstanding balance: ${money(d.balanceMinor)}.`],
    cta: { label: "View invoice", path: s(d.path) },
  }),
  "payment.failed": (d) => ({
    subject: "Your payment didn't go through",
    heading: "Payment not completed",
    paragraphs: [`The payment for ${s(d.description)} was not completed${d.reason ? ` (${s(d.reason)})` : ""}. Nothing has been charged. You can try again at any time.`],
    cta: { label: "Try again", path: s(d.path) },
  }),
  "payment.eft_pending": (d) => ({
    subject: `EFT awaiting verification: ${s(d.reference)}`,
    heading: "EFT proof uploaded",
    paragraphs: [`A client uploaded proof of payment for ${money(d.amountMinor)} (ref ${s(d.reference)}). Confirm once funds reflect.`],
    cta: { label: "Verify payment", path: s(d.path) },
  }),
  "proposal.sent": (d) => ({
    subject: `Proposal: ${s(d.title)}`,
    heading: "Your proposal is ready",
    paragraphs: [`Proposal ${s(d.reference)} (version ${s(d.version)}) totals ${money(d.totalMinor)} with a ${money(d.depositMinor)} deposit. It's valid until ${s(d.expires)}.`, "You can ask questions, accept or decline it in your client portal."],
    cta: { label: "Review proposal", path: s(d.path) },
  }),
  "proposal.decision": (d) => ({
    subject: `Proposal ${s(d.reference)} ${s(d.decision)}`,
    heading: `Proposal ${s(d.decision)}`,
    paragraphs: [`${s(d.client)} ${s(d.decision)} proposal ${s(d.reference)} v${s(d.version)}.${d.reason ? ` Reason: ${s(d.reason)}` : ""}`],
    cta: { label: "Open proposal", path: s(d.path) },
  }),
  "proposal.clarification": (d) => ({
    subject: `Question on proposal ${s(d.reference)}`,
    heading: "Client question",
    paragraphs: [s(d.body).slice(0, 1000)],
    cta: { label: "Reply", path: s(d.path) },
  }),
  "project.update": (d) => ({
    subject: `Update on ${s(d.projectName)}`,
    heading: s(d.projectName),
    paragraphs: [s(d.body).slice(0, 2000)],
    cta: { label: "Open project", path: s(d.path) },
  }),
  "project.milestone_completed": (d) => ({
    subject: `Milestone reached: ${s(d.milestone)}`,
    heading: "Milestone completed",
    paragraphs: [`“${s(d.milestone)}” on ${s(d.projectName)} is complete.`],
    cta: { label: "Open project", path: s(d.path) },
  }),
  "change_request.submitted": (d) => ({
    subject: `New ${s(d.type)} request ${s(d.reference)}`,
    heading: s(d.title),
    paragraphs: [s(d.description).slice(0, 1500)],
    cta: { label: "Triage", path: s(d.path) },
  }),
  "change_request.updated": (d) => ({
    subject: `Request ${s(d.reference)} is now ${s(d.status)}`,
    heading: s(d.title),
    paragraphs: [d.response ? s(d.response).slice(0, 1500) : `Status changed to ${s(d.status)}.`],
    cta: { label: "View request", path: s(d.path) },
  }),
  "message.new": (d) => ({
    subject: `New message: ${s(d.subject)}`,
    heading: s(d.subject),
    paragraphs: [s(d.body).slice(0, 1500)],
    cta: { label: "Reply", path: s(d.path) },
  }),
  "refund.processed": (d) => ({
    subject: `Refund of ${money(d.amountMinor)}`,
    heading: "Refund issued",
    paragraphs: [`A refund of ${money(d.amountMinor)} has been ${d.manual ? "recorded and will be paid to you by EFT" : "processed to your original payment method"}. Reason: ${s(d.reason)}.`],
  }),
};

export interface NotifyInput {
  template: keyof typeof TEMPLATES | string;
  data: Data;
  /** Recipient user (also creates an in-app notification). */
  userId?: string | null;
  /** Explicit recipient email (guests, staff alerts). */
  toEmail?: string | null;
  channels?: ("email" | "in_app")[];
  dedupeKey?: string;
  /** Respect a user's preference category. */
  category?: "projectUpdates" | "invoices";
}

export class NotificationService {
  constructor(
    private db: Database,
    private transport: EmailTransport,
    private settings: SettingsService,
    private config: AppConfig,
    private logger: Logger,
  ) {}

  get transportName() {
    return this.transport.name;
  }

  /** Queue a notification inside the caller's transaction. */
  async queue(tx: DbOrTx, input: NotifyInput): Promise<void> {
    const tpl = TEMPLATES[input.template];
    if (!tpl) throw new Error(`unknown notification template ${input.template}`);
    const brand = (await this.settings.get("business", tx)).tradingName;
    const r = tpl(input.data, brand);
    const link = r.cta?.path || (typeof input.data.path === "string" ? input.data.path : null);
    const channels = input.channels ?? ["email", "in_app"];

    let toEmail = input.toEmail ?? null;
    let prefsAllow = true;
    if (input.userId) {
      const [u] = await tx.select({ email: users.email, prefs: users.notificationPrefs }).from(users).where(eq(users.id, input.userId));
      if (u) {
        toEmail = toEmail ?? u.email;
        if (input.category === "projectUpdates") prefsAllow = u.prefs.emailProjectUpdates;
        if (input.category === "invoices") prefsAllow = u.prefs.emailInvoices;
      }
    }
    const body = r.paragraphs.join("\n\n");
    if (channels.includes("in_app") && input.userId) {
      await tx
        .insert(notifications)
        .values({
          userId: input.userId,
          channel: "in_app",
          template: input.template,
          subject: r.subject,
          body,
          link,
          data: input.data,
          status: "sent",
          sentAt: new Date(),
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:in_app` : null,
        })
        .onConflictDoNothing();
    }
    if (channels.includes("email") && toEmail) {
      await tx
        .insert(notifications)
        .values({
          userId: input.userId ?? null,
          toEmail,
          channel: "email",
          template: input.template,
          subject: r.subject,
          body,
          link,
          data: input.data,
          status: prefsAllow ? "queued" : "skipped",
          dedupeKey: input.dedupeKey ? `${input.dedupeKey}:email:${toEmail}` : null,
        })
        .onConflictDoNothing();
    }
  }

  /** Alert every configured staff address. */
  async queueStaff(tx: DbOrTx, input: Omit<NotifyInput, "userId" | "toEmail">): Promise<void> {
    const business = await this.settings.get("business", tx);
    const recipients = business.staffAlertEmails.length ? business.staffAlertEmails : [business.email];
    for (const to of recipients) {
      await this.queue(tx, { ...input, toEmail: to, channels: ["email"], dedupeKey: input.dedupeKey });
    }
  }

  private inflight = new Set<Promise<unknown>>();

  /** Fire-and-forget dispatch after a commit; errors are logged, never thrown. */
  kick(): void {
    const p = this.dispatchPending().catch((err) => this.logger.warn({ err }, "background email dispatch failed"));
    this.inflight.add(p);
    void p.finally(() => this.inflight.delete(p));
  }

  /** Wait for background dispatches (graceful shutdown / tests). */
  async idle(): Promise<void> {
    await Promise.allSettled([...this.inflight]);
  }

  /** Send queued emails. Safe to call concurrently: each row is claimed atomically. */
  async dispatchPending(limit = 25): Promise<number> {
    const now = new Date();
    const pending = await this.db
      .select()
      .from(notifications)
      .where(and(eq(notifications.channel, "email"), or(eq(notifications.status, "queued"), and(eq(notifications.status, "failed"), lt(notifications.attempts, 5)))))
      .orderBy(asc(notifications.createdAt))
      .limit(limit);
    if (pending.length === 0) return 0;
    const brand = (await this.settings.business()).tradingName;
    let sent = 0;
    for (const n of pending) {
      const claimed = await this.db
        .update(notifications)
        .set({ status: "sent", attempts: n.attempts + 1, sentAt: now })
        .where(and(eq(notifications.id, n.id), inArray(notifications.status, ["queued", "failed"]), isNull(notifications.readAt)))
        .returning({ id: notifications.id });
      if (claimed.length === 0) continue;
      try {
        const tpl = TEMPLATES[n.template];
        const r = tpl ? tpl(n.data, brand) : { subject: n.subject, heading: n.subject, paragraphs: [n.body] };
        const url = n.link ? (n.link.startsWith("http") ? n.link : `${this.config.PUBLIC_WEB_URL}${n.link}`) : undefined;
        const text = `${r.paragraphs.join("\n\n")}${url ? `\n\n${r.cta?.label ?? "Open"}: ${url}` : ""}\n\n— ${brand}`;
        const html = renderEmailHtml({
          brand,
          heading: r.heading,
          paragraphs: r.paragraphs,
          cta: url ? { label: r.cta?.label ?? "Open", url } : undefined,
          footer: `${brand} · This is a transactional message about your account or enquiry.`,
        });
        const res = await this.transport.send({ to: n.toEmail!, subject: n.subject, text, html });
        await this.db.update(notifications).set({ providerMessageId: res.id }).where(eq(notifications.id, n.id));
        sent++;
      } catch (err) {
        this.logger.warn({ err, notificationId: n.id }, "email send failed");
        await this.db.update(notifications).set({ status: "failed", error: String((err as Error).message).slice(0, 500) }).where(eq(notifications.id, n.id));
      }
    }
    return sent;
  }
}
