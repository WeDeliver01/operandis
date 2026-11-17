import nodemailer from "nodemailer";
import type { AppConfig } from "../config/env";
import type { Logger } from "../lib/logger";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface EmailTransport {
  readonly name: string;
  send(msg: EmailMessage): Promise<{ id: string | null }>;
}

/** Development/test transport: logs and keeps an in-memory outbox (never used in production). */
export class LogTransport implements EmailTransport {
  readonly name = "log";
  readonly outbox: (EmailMessage & { at: Date })[] = [];
  constructor(private logger: Logger) {}
  async send(msg: EmailMessage) {
    this.outbox.push({ ...msg, at: new Date() });
    if (this.outbox.length > 500) this.outbox.shift();
    this.logger.info({ to: msg.to, subject: msg.subject }, "email (log driver)");
    return { id: null };
  }
}

export class SmtpTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: nodemailer.Transporter;
  constructor(private config: AppConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT ?? 587,
      secure: config.SMTP_SECURE,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }
  async send(msg: EmailMessage) {
    const info = await this.transporter.sendMail({ from: this.config.EMAIL_FROM, to: msg.to, subject: msg.subject, text: msg.text, html: msg.html });
    return { id: info.messageId ?? null };
  }
}

export function createEmailTransport(config: AppConfig, logger: Logger): EmailTransport {
  return config.EMAIL_DRIVER === "smtp" ? new SmtpTransport(config) : new LogTransport(logger);
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Minimal, brand-consistent HTML wrapper. All interpolated text is escaped. */
export function renderEmailHtml(opts: { brand: string; heading: string; paragraphs: string[]; cta?: { label: string; url: string }; footer: string }): string {
  const p = opts.paragraphs.map((t) => `<p style="margin:0 0 16px;color:#5B6271;font-size:15px;line-height:1.6">${esc(t)}</p>`).join("");
  const cta = opts.cta
    ? `<p style="margin:24px 0"><a href="${esc(opts.cta.url)}" style="background:#0F1115;color:#FAFAF7;padding:12px 20px;text-decoration:none;font-size:13px;letter-spacing:.06em;text-transform:uppercase;border-radius:2px">${esc(opts.cta.label)}</a></p>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#FAFAF7;font-family:Inter,Segoe UI,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #E5E7EB">
<tr><td style="padding:28px 32px;border-bottom:1px solid #E5E7EB;font-family:Georgia,serif;font-size:20px;color:#0F1115">${esc(opts.brand)}</td></tr>
<tr><td style="padding:32px"><h1 style="margin:0 0 16px;font-family:Georgia,serif;font-weight:500;font-size:24px;color:#0F1115">${esc(opts.heading)}</h1>${p}${cta}</td></tr>
<tr><td style="padding:20px 32px;border-top:1px solid #E5E7EB;color:#9AA0AC;font-size:12px">${esc(opts.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}
