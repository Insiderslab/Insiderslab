/**
 * Outgoing email (review requests, reminders, agency notifications).
 *
 * Transport is picked the same way as heili-dm's magic links: SMTP when
 * EMAIL_SERVER is set (self-hosters), otherwise Resend over its HTTP API when
 * a real RESEND_API_KEY is configured, otherwise the email is only logged so
 * local development works without any mail service. sendEmail never throws:
 * a mail outage must not roll back an approval or a submission.
 */

import nodemailer, { type Transporter } from "nodemailer";

export interface EmailMessage {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}

export type EmailTransport = "smtp" | "resend" | "console";

export interface SendEmailResult {
  ok: boolean;
  transport: EmailTransport;
  error?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 15_000;

function getEmailFrom(): string {
  return process.env.EMAIL_FROM ?? "Approve by Heili <noreply@example.com>";
}

/** Placeholder keys from .env.example / docker defaults must not hit Resend. */
export function isRealResendKey(key: string | undefined): key is string {
  if (!key) return false;
  if (!key.startsWith("re_")) return false;
  return !/placeholder|changeme|missing|^re_(dev|test|xxx)/i.test(key);
}

export function getEmailTransport(): EmailTransport {
  if (process.env.EMAIL_SERVER) return "smtp";
  if (isRealResendKey(process.env.RESEND_API_KEY)) return "resend";
  return "console";
}

/** Trimmed, lower-cased, de-duplicated list of plausible addresses. */
export function normalizeRecipients(to: string | string[]): string[] {
  const list = Array.isArray(to) ? to : [to];
  const seen = new Set<string>();
  for (const raw of list) {
    const email = raw.trim().toLowerCase();
    if (email && email.includes("@") && !/[\s<>,;]/.test(email)) seen.add(email);
  }
  return [...seen];
}

let smtpTransporter: Transporter | null = null;

function getSmtpTransporter(): Transporter {
  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport(process.env.EMAIL_SERVER as string);
  }
  return smtpTransporter;
}

async function sendViaResend(message: EmailMessage, to: string[]): Promise<void> {
  const response = await fetch(RESEND_ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: getEmailFrom(),
      to,
      subject: message.subject,
      html: message.html,
      text: message.text,
      ...(message.replyTo ? { reply_to: message.replyTo } : {}),
    }),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);
    throw new Error(`Resend HTTP ${response.status}: ${detail}`);
  }
}

export async function sendEmail(message: EmailMessage): Promise<SendEmailResult> {
  const transport = getEmailTransport();
  const to = normalizeRecipients(message.to);
  // Subjects carry user content (post titles): no header line breaks.
  message = { ...message, subject: message.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 250) };

  if (to.length === 0) {
    return { ok: false, transport, error: "no recipients" };
  }

  try {
    if (transport === "smtp") {
      await getSmtpTransporter().sendMail({
        from: getEmailFrom(),
        to,
        subject: message.subject,
        html: message.html,
        text: message.text,
        replyTo: message.replyTo,
      });
    } else if (transport === "resend") {
      await sendViaResend(message, to);
    } else if (process.env.NODE_ENV === "production") {
      // Bodies contain personal review links: never dump them into prod logs.
      console.warn(`[email] No transport configured, email not sent: "${message.subject}"`);
      return { ok: false, transport, error: "no transport configured" };
    } else {
      console.info(`[email:dev] To: ${to.join(", ")}\nSubject: ${message.subject}\n\n${message.text}\n`);
    }
    return { ok: true, transport };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.error(`[email] Failed to send "${message.subject}" via ${transport}: ${reason}`);
    return { ok: false, transport, error: reason };
  }
}

// ─── Templates ───────────────────────────────────────────────────────────────

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Only http(s) links end up in an href; anything else is dropped. */
export function safeHref(url: string): string | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export interface EmailListItem {
  title: string;
  detail?: string;
}

export interface EmailContent {
  /** Short heading shown at the top of the email. */
  heading: string;
  /** Plain-text paragraphs; newlines inside a paragraph are kept. */
  paragraphs: string[];
  items?: EmailListItem[];
  /** Optional quoted block, e.g. the client's comment. */
  quote?: string;
  cta?: { label: string; url: string };
  footer?: string;
}

/**
 * Renders a plain, inline-styled email. Every string is escaped here, so
 * callers pass raw user content (post titles, client comments) as-is.
 */
export function renderEmail(content: EmailContent): { html: string; text: string } {
  const paragraph = (value: string) =>
    `<p style="margin:0 0 14px;line-height:1.55">${escapeHtml(value).replace(/\n/g, "<br>")}</p>`;

  const itemsHtml = content.items?.length
    ? `<ul style="margin:0 0 16px;padding-left:20px">${content.items
        .map(
          (item) =>
            `<li style="margin:0 0 8px;line-height:1.45"><strong>${escapeHtml(item.title)}</strong>${
              item.detail ? `<br><span style="color:#6b6b6b">${escapeHtml(item.detail)}</span>` : ""
            }</li>`
        )
        .join("")}</ul>`
    : "";

  const quoteHtml = content.quote
    ? `<blockquote style="margin:0 0 16px;padding:10px 14px;border-left:3px solid #d4d4d4;color:#333;line-height:1.5">${escapeHtml(
        content.quote
      ).replace(/\n/g, "<br>")}</blockquote>`
    : "";

  const href = content.cta ? safeHref(content.cta.url) : null;
  const ctaHtml =
    content.cta && href
      ? `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 18px;border-radius:6px;font-weight:600">${escapeHtml(
          content.cta.label
        )}</a></p><p style="margin:0 0 14px;font-size:12px;color:#6b6b6b;word-break:break-all">${escapeHtml(href)}</p>`
      : "";

  const footer = content.footer ?? "Approve by Heili";

  const html = `<!doctype html><html lang="it"><body style="margin:0;padding:24px;background:#f6f6f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111;font-size:15px"><div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e5e5e5;border-radius:8px;padding:28px"><h1 style="margin:0 0 18px;font-size:19px;line-height:1.3">${escapeHtml(
    content.heading
  )}</h1>${content.paragraphs.map(paragraph).join("")}${quoteHtml}${itemsHtml}${ctaHtml}<p style="margin:24px 0 0;font-size:12px;color:#8a8a8a">${escapeHtml(
    footer
  )}</p></div></body></html>`;

  const textParts = [content.heading, "", ...content.paragraphs.flatMap((p) => [p, ""])];
  if (content.quote) textParts.push(content.quote.replace(/^/gm, "> "), "");
  if (content.items?.length) {
    for (const item of content.items) {
      textParts.push(`- ${item.title}${item.detail ? ` (${item.detail})` : ""}`);
    }
    textParts.push("");
  }
  if (content.cta && href) textParts.push(`${content.cta.label}: ${href}`, "");
  textParts.push(footer);

  return { html, text: textParts.join("\n") };
}
