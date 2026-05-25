// SMTP transport for the PM email module. Default config targets Gmail /
// Google Workspace; set SMTP_HOST + SMTP_PORT in .env.local to point at any
// other SMTP provider (Postmark, Mailgun, SES, etc) without code changes.
//
// Required env:
//   SMTP_USER       — authenticating account (e.g. automations@davnoot.com)
//   SMTP_PASSWORD   — Google App Password (NOT the account password).
//                     Generate at https://myaccount.google.com/apppasswords
//                     after enabling 2FA on the SMTP_USER account. For
//                     Google Workspace, the admin may also need to allow
//                     "Less secure" SMTP or grant App-Password access.
// Optional env:
//   SMTP_HOST       — defaults to smtp.gmail.com
//   SMTP_PORT       — defaults to 587 (STARTTLS). Set to 465 for SMTPS.
//   SMTP_FROM       — overrides the From address. Must be SMTP_USER or a
//                     Workspace "Send as" alias verified on that account.
//                     Defaults to SMTP_USER.
//
// Missing SMTP_USER or SMTP_PASSWORD → `skipped: true`, no error. Lets local
// dev exercise the full lifecycle without delivering real mail.
//
// Reply-To is always set to the PM-side `fromMailbox` snapshot so replies
// route back to whichever per-property mailbox the message was composed
// against, even when SMTP_FROM funnels every send through a single sender.
import nodemailer, { type Transporter } from 'nodemailer';

export interface SendEmailInput {
  /** Snapshot from `EmailMessage.fromMailbox`. Used as Reply-To. */
  fromMailbox: string;
  /** Display name to show on the From line. */
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  /** Rich-text HTML body — matches the EmailMessage schema. */
  html: string;
}

export interface SendEmailResult {
  delivered: boolean;
  providerMessageId?: string;
  error?: string;
  /** True when SMTP creds are unset — caller treats as "recorded but not
   *  transmitted", which is the prior dev behaviour. */
  skipped?: boolean;
}

let cachedTransport: Transporter | null = null;

function getTransport(): Transporter | null {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASSWORD;
  if (!user || !pass) return null;
  if (cachedTransport) return cachedTransport;
  const port = Number(process.env.SMTP_PORT || 587);
  cachedTransport = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure: port === 465,
    auth: { user, pass },
  });
  return cachedTransport;
}

function formatFrom(addr: string, name?: string): string {
  if (!name) return addr;
  const safe = name.replace(/[<>"]/g, '').trim();
  if (!safe) return addr;
  return `${safe} <${addr}>`;
}

export async function sendEmail(input: SendEmailInput): Promise<SendEmailResult> {
  const transport = getTransport();
  if (!transport) return { delivered: false, skipped: true };

  const fromAddr = process.env.SMTP_FROM || process.env.SMTP_USER!;
  const from = formatFrom(fromAddr, input.fromName);

  try {
    const info = await transport.sendMail({
      from,
      to: input.to,
      cc: input.cc && input.cc.length > 0 ? input.cc : undefined,
      bcc: input.bcc && input.bcc.length > 0 ? input.bcc : undefined,
      replyTo: input.fromMailbox,
      subject: input.subject,
      html: input.html || ' ',
    });
    return { delivered: true, providerMessageId: info.messageId };
  } catch (err) {
    return {
      delivered: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
