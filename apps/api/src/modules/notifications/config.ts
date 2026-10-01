import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { badRequest } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { mask } from "../../lib/secretBox";
import { openSecret, sealSecret } from "../../lib/secrets";

/** Stored in Setting as JSON. Secrets are AES-GCM sealed and never returned to the browser. */
export const emailConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["sendgrid", "log"]),
  fromEmail: z.string().trim().email(),
  fromName: z.string().trim().min(1).max(80),
  staffRecipients: z.array(z.string().trim().email()).max(10),
  apiKey: z.string().trim().min(10).max(300).optional(), // only sent when changing it
});
export const smsConfigSchema = z.object({
  enabled: z.boolean(),
  provider: z.enum(["twilio", "log"]),
  accountSid: z.string().trim().regex(/^AC[0-9a-fA-F]{32}$/, "Twilio Account SID starts with AC").optional().or(z.literal("")),
  fromNumber: z.string().trim().max(30).optional().or(z.literal("")), // +1… number or approved alphanumeric sender ID
  messagingServiceSid: z.string().trim().regex(/^MG[0-9a-fA-F]{32}$/).optional().or(z.literal("")),
  customerAcknowledgements: z.boolean(), // text customers after an inquiry / submission
  authToken: z.string().trim().min(20).max(100).optional(),
});

export type EmailConfig = Omit<z.infer<typeof emailConfigSchema>, "apiKey"> & { apiKeySealed?: string };
export type SmsConfig = Omit<z.infer<typeof smsConfigSchema>, "authToken"> & { authTokenSealed?: string };

const DEFAULT_EMAIL: EmailConfig = { enabled: false, provider: "log", fromEmail: "no-reply@brookrege.com", fromName: "Brookrege", staffRecipients: [] };
const DEFAULT_SMS: SmsConfig = { enabled: false, provider: "log", customerAcknowledgements: true };

async function read<T>(key: string, fallback: T): Promise<T> {
  const row = await prisma.setting.findUnique({ where: { key } });
  return row ? { ...fallback, ...(row.value as object) } : fallback;
}
async function write(key: string, value: object) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonObject }, update: { value: value as Prisma.InputJsonObject } });
}


export const getEmailConfig = () => read<EmailConfig>("notifications.email", DEFAULT_EMAIL);
export const getSmsConfig = () => read<SmsConfig>("notifications.sms", DEFAULT_SMS);

export async function saveEmailConfig(input: z.infer<typeof emailConfigSchema>) {
  const current = await getEmailConfig();
  const { apiKey, ...rest } = input;
  const next: EmailConfig = { ...rest, apiKeySealed: apiKey ? sealSecret(apiKey) : current.apiKeySealed };
  if (next.enabled && next.provider === "sendgrid" && !next.apiKeySealed) throw badRequest("Enter the SendGrid API key to enable email.");
  await write("notifications.email", next);
  return publicEmail(next);
}

export async function saveSmsConfig(input: z.infer<typeof smsConfigSchema>) {
  const current = await getSmsConfig();
  const { authToken, ...rest } = input;
  const next: SmsConfig = { ...rest, authTokenSealed: authToken ? sealSecret(authToken) : current.authTokenSealed };
  if (next.enabled && next.provider === "twilio") {
    if (!next.accountSid || !next.authTokenSealed) throw badRequest("Enter the Twilio Account SID and Auth Token to enable SMS.");
    if (!next.fromNumber && !next.messagingServiceSid) throw badRequest("Enter a sender number or a Messaging Service SID.");
  }
  await write("notifications.sms", next);
  return publicSms(next);
}

export const secretOf = (sealed?: string) => (sealed ? openSecret(sealed) : undefined);

/** What the admin UI sees: never the secret, only whether one is set and its last 4 characters. */
export function publicEmail({ apiKeySealed, ...c }: EmailConfig) {
  let hint: string | null = null;
  try { const k = secretOf(apiKeySealed); hint = k ? mask(k) : null; } catch { hint = "(cannot decrypt — re-enter)"; }
  return { ...c, apiKeySet: Boolean(apiKeySealed), apiKeyHint: hint };
}
export function publicSms({ authTokenSealed, ...c }: SmsConfig) {
  let hint: string | null = null;
  try { const k = secretOf(authTokenSealed); hint = k ? mask(k) : null; } catch { hint = "(cannot decrypt — re-enter)"; }
  return { ...c, authTokenSet: Boolean(authTokenSealed), authTokenHint: hint };
}
