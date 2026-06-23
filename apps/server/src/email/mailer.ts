// SMTP mailer (nodemailer). A single lazily-created transport reused across the
// process. Email is optional: if SMTP env isn't set, `mailConfigured()` is false
// and the digest job/route no-ops instead of throwing.
import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '../env';

let cached: Transporter | null = null;

export function mailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS);
}

/** The address mail is sent from (defaults to the auth user if MAIL_FROM unset). */
export function mailFrom(): string {
  return env.MAIL_FROM || env.SMTP_USER;
}

function transport(): Transporter {
  if (cached) return cached;
  cached = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE, // true for 465 (implicit TLS)
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  return cached;
}

export interface Mail {
  to: string | string[];
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(m: Mail): Promise<void> {
  if (!mailConfigured()) throw new Error('smtp_not_configured');
  await transport().sendMail({
    from: mailFrom(),
    to: Array.isArray(m.to) ? m.to.join(', ') : m.to,
    subject: m.subject,
    text: m.text,
    html: m.html,
  });
}

/** Confirm the SMTP credentials/host actually connect (used by the test route). */
export async function verifyMail(): Promise<boolean> {
  if (!mailConfigured()) return false;
  try {
    await transport().verify();
    return true;
  } catch {
    return false;
  }
}
