import type { NotificationChannel } from "@prisma/client";
import { renderTemplate, toE164Egypt } from "@brookrege/domain";
import { renderEmail } from "./renderEmail";
import { env } from "../../config/env";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { enqueue } from "../jobs/queue";
import { getEmailConfig, getSmsConfig, secretOf } from "./config";
import { PermanentSendError, sendgridSend, twilioSend, type EmailMessage, type SendResult } from "./providers";
import { notifications } from "../../metrics/registry";

/** Development / not-yet-configured provider: writes the message to the log instead of sending it. */
function logSend(channel: "EMAIL" | "SMS", to: string[], subject: string | null, body: string): SendResult {
  logger.info("notification_logged_not_sent", { channel, to, subject, preview: body.slice(0, 300) });
  return { provider: "log", messageId: null };
}

export type Locale = "ar" | "en";
type Vars = Record<string, string | number | null | undefined>;

/** Queue a message. Sending happens in the background worker, so a slow provider never slows the website. */
export async function queueEmail(templateKey: string, to: string[] | "staff", vars: Vars, locale: Locale = "ar", attachments?: EmailMessage["attachments"]) {
  await enqueue("send_email", { templateKey, to, vars: vars as Record<string, string>, locale, ...(attachments ? { attachments } : {}) });
}
export async function queueSms(templateKey: string, phone: string, vars: Vars, locale: Locale = "ar") {
  await enqueue("send_sms", { templateKey, phone, vars: vars as Record<string, string>, locale }, { maxAttempts: 3 });
}

async function template(key: string, channel: NotificationChannel, locale: string) {
  const rows = await prisma.notificationTemplate.findMany({ where: { key, channel, isActive: true, locale: { in: [locale, "ar", "en"] } } });
  return rows.find((r) => r.locale === locale) ?? rows.find((r) => r.locale === "ar") ?? rows[0] ?? null;
}

async function log(entry: { channel: NotificationChannel; recipient: string; templateKey: string; subject?: string | null; status: "SENT" | "FAILED" | "SKIPPED"; provider: string; providerMessageId?: string | null; error?: string; jobId?: string }) {
  notifications.inc({ channel: entry.channel, status: entry.status });
  await prisma.notificationLog.create({ data: { ...entry, subject: entry.subject ?? null, error: entry.error?.slice(0, 1000) } }).catch((e) => logger.error("notification_log_failed", { message: e.message }));
}

/** Job handler: render + send one email. Throws on temporary failure (the queue retries). */
export async function deliverEmail(p: { templateKey: string; to: string[] | "staff"; vars: Vars; locale: Locale; attachments?: EmailMessage["attachments"] }, jobId?: string) {
  const cfg = await getEmailConfig();
  const to = p.to === "staff" ? cfg.staffRecipients : p.to;
  const recipient = to.join(", ") || "(no staff recipients configured)";
  const t = await template(p.templateKey, "EMAIL", p.locale);
  if (!t) return log({ channel: "EMAIL", recipient, templateKey: p.templateKey, status: "SKIPPED", provider: "-", error: "Template missing or disabled", jobId });
  if (!cfg.enabled || !to.length) return log({ channel: "EMAIL", recipient, templateKey: p.templateKey, status: "SKIPPED", provider: cfg.provider, error: !cfg.enabled ? "Email is turned off" : "No recipients", jobId });

  const vars = { adminUrl: env.ADMIN_APP_URL, ...p.vars };
  const { subject, text, html } = renderEmail(t, vars);
  try {
    const r: SendResult = cfg.provider === "sendgrid"
      ? await sendgridSend(secretOf(cfg.apiKeySealed)!, { email: cfg.fromEmail, name: cfg.fromName }, { to, subject, text, html, attachments: p.attachments })
      : logSend("EMAIL", to, subject, text);
    await log({ channel: "EMAIL", recipient, templateKey: p.templateKey, subject, status: "SENT", provider: r.provider, providerMessageId: r.messageId, jobId });
  } catch (err) {
    await log({ channel: "EMAIL", recipient, templateKey: p.templateKey, subject, status: "FAILED", provider: cfg.provider, error: (err as Error).message, jobId });
    if (err instanceof PermanentSendError) return; // retrying cannot help (bad key/address) — logged as FAILED
    throw err;
  }
}

export async function deliverSms(p: { templateKey: string; phone: string; vars: Vars; locale: Locale }, jobId?: string) {
  const cfg = await getSmsConfig();
  const to = toE164Egypt(p.phone);
  const t = await template(p.templateKey, "SMS", p.locale);
  const skip = !to ? "Not an Egyptian mobile number" : !t ? "Template missing or disabled" : !cfg.enabled ? "SMS is turned off" : null;
  if (skip) return log({ channel: "SMS", recipient: p.phone, templateKey: p.templateKey, status: "SKIPPED", provider: cfg.provider, error: skip, jobId });
  const body = renderTemplate(t!.body, p.vars).text;
  try {
    const r = cfg.provider === "twilio"
      ? await twilioSend({ accountSid: cfg.accountSid!, authToken: secretOf(cfg.authTokenSealed)!, from: cfg.fromNumber || undefined, messagingServiceSid: cfg.messagingServiceSid || undefined }, to!, body)
      : logSend("SMS", [to!], null, body);
    await log({ channel: "SMS", recipient: to!, templateKey: p.templateKey, status: "SENT", provider: r.provider, providerMessageId: r.messageId, jobId });
  } catch (err) {
    await log({ channel: "SMS", recipient: to!, templateKey: p.templateKey, status: "FAILED", provider: cfg.provider, error: (err as Error).message, jobId });
    if (err instanceof PermanentSendError) return;
    throw err;
  }
}

/** Events → messages. Called after the triggering row is saved; failures are logged, never shown to visitors. */
export const events = {
  async inquiryCreated(i: { name: string; phone: string; message?: string | null; propertyTitle?: string | null }, locale: Locale) {
    const vars = { name: i.name, phone: i.phone, message: i.message ?? "—", propertyTitle: i.propertyTitle ?? "—" };
    await queueEmail("inquiry_staff", "staff", vars, "ar");
    if ((await getSmsConfig()).customerAcknowledgements) await queueSms("inquiry_customer_ack", i.phone, vars, locale);
  },
  async submissionCreated(s: { ownerName: string; phone: string; propertyType?: string | null; transaction?: string | null; location?: string | null; details?: string | null }, locale: Locale) {
    const vars = { ownerName: s.ownerName, phone: s.phone, propertyType: s.propertyType ?? "—", transaction: s.transaction ?? "—", location: s.location ?? "—", details: s.details ?? "—" };
    await queueEmail("submission_staff", "staff", vars, "ar");
    if ((await getSmsConfig()).customerAcknowledgements) await queueSms("submission_owner_ack", s.phone, vars, locale);
  },
  async teamMemberCreated(u: { email: string; name: string; role: string }) {
    await queueEmail("team_welcome", [u.email], { name: u.name, role: u.role.replace("_", " ").toLowerCase() }, "en");
  },
};
