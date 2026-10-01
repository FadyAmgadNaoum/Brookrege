/**
 * Personal-data rules (Egypt's Personal Data Protection Law 151/2020 and GDPR-style practice):
 * keep visitors' contact details only as long as they are useful, find everything held about a
 * person on request, and remove it on request.
 */

export interface PrivacyPolicy {
  /** Leads (inquiries, "add your property" requests) untouched for this long are anonymized. */
  leadRetentionMonths: number;
  /** Delivery logs are deleted, and IP addresses/browsers in the activity log blanked, after this long. */
  logRetentionMonths: number;
}

export const DEFAULT_PRIVACY_POLICY: PrivacyPolicy = { leadRetentionMonths: 24, logRetentionMonths: 12 };
export const PRIVACY_LIMITS = { leadRetentionMonths: [6, 120], logRetentionMonths: [3, 36] } as const;

/** Text left in place of removed personal data. */
export const REMOVED = "[removed]";

/** `months` calendar months before `now` (UTC), clamping the day (31 Mar − 1 month → 28/29 Feb). */
export function monthsBefore(now: Date, months: number): Date {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() - months;
  const target = new Date(Date.UTC(y, m, 1, now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds(), now.getUTCMilliseconds()));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(now.getUTCDate(), lastDay));
  return target;
}

export function retentionCutoffs(policy: PrivacyPolicy, now = new Date()) {
  return { leads: monthsBefore(now, policy.leadRetentionMonths), logs: monthsBefore(now, policy.logRetentionMonths) };
}

/**
 * Every way the same phone number may have been stored (visitors type 010…, +2010…, 002010…),
 * so a lookup finds all of them. Non-Egyptian numbers match on their digits, with and without "+".
 * Returns [] for input that isn't a phone number.
 */
export function phoneVariants(input: string): string[] {
  const d = input.replace(/[\s\-().]/g, "");
  let local: string | null = null;
  if (/^01[0125]\d{8}$/.test(d)) local = d.slice(1);
  else if (/^\+201[0125]\d{8}$/.test(d)) local = d.slice(3);
  else if (/^00201[0125]\d{8}$/.test(d)) local = d.slice(4);
  else if (/^201[0125]\d{8}$/.test(d)) local = d.slice(2);
  if (local) return [`0${local}`, `+20${local}`, `20${local}`, `0020${local}`];
  const digits = d.replace(/^\+|^00/, "");
  if (!/^\d{8,15}$/.test(digits)) return [];
  return [digits, `+${digits}`, `00${digits}`];
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}

/** For activity logs and screens: enough to recognise a number, not enough to reuse it. */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\s/g, "");
  if (d.length <= 5) return "•••";
  return `${d.slice(0, 3)}${"•".repeat(Math.max(3, d.length - 6))}${d.slice(-3)}`;
}

export function maskEmail(email: string): string {
  const [user = "", domain] = email.split("@");
  if (!user || !domain) return "•••";
  return `${user.slice(0, 1)}•••@${domain}`;
}
