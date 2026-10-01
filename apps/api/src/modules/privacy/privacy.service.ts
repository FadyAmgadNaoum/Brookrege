import { Prisma } from "@prisma/client";
import type { Request } from "express";
import {
  DEFAULT_PRIVACY_POLICY, REMOVED, maskEmail, maskPhone, normalizeEmail, phoneVariants, retentionCutoffs, type PrivacyPolicy,
} from "@brookrege/domain";
import { audit } from "../../lib/audit";
import { badRequest } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";

type Tx = Prisma.TransactionClient;
const POLICY_KEY = "privacy.policy";
const LAST_RUN_KEY = "privacy.lastRun";

export async function getPrivacyPolicy(): Promise<PrivacyPolicy> {
  const row = await prisma.setting.findUnique({ where: { key: POLICY_KEY } });
  return { ...DEFAULT_PRIVACY_POLICY, ...((row?.value as Partial<PrivacyPolicy> | null) ?? {}) };
}

export async function savePrivacyPolicy(p: PrivacyPolicy) {
  const value = p as unknown as Prisma.InputJsonObject;
  await prisma.setting.upsert({ where: { key: POLICY_KEY }, create: { key: POLICY_KEY, value }, update: { value } });
}

export interface RetentionRun { at: string; inquiries: number; submissions: number; notificationLogs: number; auditEntries: number; sessions: number; trigger: "schedule" | "manual" }

export async function getLastRetentionRun(): Promise<RetentionRun | null> {
  const row = await prisma.setting.findUnique({ where: { key: LAST_RUN_KEY } });
  return (row?.value as RetentionRun | null) ?? null;
}

/** The activity log is append-only (database trigger); privacy clean-up is the one sanctioned exception. */
async function auditMaintenance(tx: Tx) {
  await tx.$executeRawUnsafe(`SET LOCAL brookrege.audit_maintenance = 'on'`);
}

/** Staff notes can hold personal details, so they are removed from past activity entries too (status history stays). */
async function scrubLeadAudit(tx: Tx, entityType: "Inquiry" | "PropertySubmission", ids: string[]) {
  if (!ids.length) return 0;
  await auditMaintenance(tx);
  return tx.$executeRaw`
    UPDATE "AuditLog" SET "before" = "before" - 'staffNote', "after" = "after" - 'staffNote'
    WHERE "entityType" = ${entityType} AND "entityId" = ANY(${ids}::text[])
      AND (("before" -> 'staffNote') IS NOT NULL OR ("after" -> 'staffNote') IS NOT NULL)`;
}

const anonymizedInquiry = (at: Date) => ({ name: REMOVED, phone: REMOVED, email: null, message: null, staffNote: null, anonymizedAt: at });
const anonymizedSubmission = (at: Date) => ({ ownerName: REMOVED, phone: REMOVED, location: null, details: null, staffNote: null, anonymizedAt: at });

// ───────────────────────── Retention (nightly) ─────────────────────────

/**
 * Nightly clean-up (job "privacy_retention"):
 *  - leads not updated for `leadRetentionMonths` → contact details removed (counts and statuses kept for reports);
 *  - notification delivery logs older than `logRetentionMonths` → deleted;
 *  - activity-log entries older than `logRetentionMonths` → IP address and browser blanked;
 *  - staff sign-in sessions (IP, browser) that expired more than `logRetentionMonths` ago → deleted,
 *    and refresh tokens more than 30 days past expiry (useless by then) → deleted.
 */
export async function runRetention(trigger: RetentionRun["trigger"] = "schedule", now = new Date()): Promise<RetentionRun> {
  const policy = await getPrivacyPolicy();
  const cut = retentionCutoffs(policy, now);

  const result = await prisma.$transaction(async (tx) => {
    const inq = await tx.inquiry.findMany({ where: { anonymizedAt: null, updatedAt: { lt: cut.leads } }, select: { id: true } });
    const sub = await tx.propertySubmission.findMany({ where: { anonymizedAt: null, updatedAt: { lt: cut.leads } }, select: { id: true } });
    const inqIds = inq.map((r) => r.id), subIds = sub.map((r) => r.id);
    if (inqIds.length) await tx.inquiry.updateMany({ where: { id: { in: inqIds } }, data: anonymizedInquiry(now) });
    if (subIds.length) await tx.propertySubmission.updateMany({ where: { id: { in: subIds } }, data: anonymizedSubmission(now) });
    await scrubLeadAudit(tx, "Inquiry", inqIds);
    await scrubLeadAudit(tx, "PropertySubmission", subIds);

    const logs = await tx.notificationLog.deleteMany({ where: { createdAt: { lt: cut.logs } } });
    await auditMaintenance(tx);
    const auditEntries = await tx.$executeRaw`
      UPDATE "AuditLog" SET ip = NULL, "userAgent" = NULL
      WHERE "createdAt" < ${cut.logs} AND (ip IS NOT NULL OR "userAgent" IS NOT NULL)`;

    const sessions = await tx.adminSession.deleteMany({ where: { expiresAt: { lt: cut.logs } } });
    await tx.refreshToken.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });

    const run: RetentionRun = { at: now.toISOString(), inquiries: inqIds.length, submissions: subIds.length, notificationLogs: logs.count, auditEntries, sessions: sessions.count, trigger };
    const value = run as unknown as Prisma.InputJsonObject;
    await tx.setting.upsert({ where: { key: LAST_RUN_KEY }, create: { key: LAST_RUN_KEY, value }, update: { value } });
    if (run.inquiries || run.submissions || run.notificationLogs || run.auditEntries || run.sessions) {
      await audit(null, { action: "privacy.retention", entityType: "Privacy", after: { ...run, policy } }, tx);
    }
    return run;
  }, { timeout: 120_000 });

  logger.info("privacy_retention", { ...result });
  return result;
}

// ───────────────────────── Requests from a person ─────────────────────────

export interface Subject { phone?: string; email?: string }

function subjectKeys(s: Subject) {
  const phones = s.phone ? phoneVariants(s.phone) : [];
  const email = s.email ? normalizeEmail(s.email) : null;
  if (s.phone && !phones.length) throw badRequest("That doesn't look like a phone number.");
  if (!phones.length && !email) throw badRequest("Enter a phone number or an email address.");
  return { phones, email };
}

const describe = (s: Subject) => ({ phone: s.phone ? maskPhone(s.phone) : undefined, email: s.email ? maskEmail(s.email) : undefined });

/** Everything held about one person, found by phone number (any format) and/or email. */
export async function findSubject(s: Subject) {
  const { phones, email } = subjectKeys(s);
  const inquiryWhere: Prisma.InquiryWhereInput = { OR: [
    ...(phones.length ? [{ phone: { in: phones } }] : []),
    ...(email ? [{ email: { equals: email, mode: "insensitive" as const } }] : []),
  ] };
  const [inquiries, submissions, notifications] = await Promise.all([
    prisma.inquiry.findMany({
      where: inquiryWhere, orderBy: { createdAt: "asc" },
      select: { id: true, name: true, phone: true, email: true, message: true, status: true, createdAt: true, updatedAt: true, anonymizedAt: true, property: { select: { id: true, title: true } } },
    }),
    phones.length
      ? prisma.propertySubmission.findMany({
          where: { phone: { in: phones } }, orderBy: { createdAt: "asc" },
          select: { id: true, ownerName: true, phone: true, propertyType: true, transaction: true, location: true, details: true, status: true, createdAt: true, updatedAt: true, anonymizedAt: true },
        })
      : Promise.resolve([]),
    prisma.$queryRaw<{ id: string; channel: string; recipient: string; templateKey: string | null; subject: string | null; status: string; createdAt: Date }[]>`
      SELECT id, channel::text AS channel, recipient, "templateKey", subject, status::text AS status, "createdAt" FROM "NotificationLog"
      WHERE recipient = ANY(${phones}::text[]) OR (${email}::text IS NOT NULL AND ${email}::text = ANY(string_to_array(lower(recipient), ', ')))
      ORDER BY "createdAt"`,
  ]);
  return { inquiries, submissions, notifications };
}

/** A copy for the person (right of access / portability), as JSON. */
export async function exportSubject(req: Request, s: Subject) {
  const data = await findSubject(s);
  await audit(req, { action: "privacy.export", entityType: "Privacy", after: { subject: describe(s), inquiries: data.inquiries.length, submissions: data.submissions.length, notifications: data.notifications.length } });
  return {
    generatedAt: new Date().toISOString(),
    controller: "Brookrege — real estate brokerage, Sohag, Egypt",
    purpose: "Answering property inquiries and listing requests you sent through our website.",
    ...data,
  };
}

/** Right to erasure: removes the person's contact details everywhere we keep them. Irreversible. */
export async function eraseSubject(req: Request, s: Subject) {
  const { phones, email } = subjectKeys(s);
  const found = await findSubject(s);
  const now = new Date();
  const inqIds = found.inquiries.map((r) => r.id), subIds = found.submissions.map((r) => r.id);
  // Also use every number/address found on the person's records (they may have used several).
  const allPhones = [...new Set([...phones, ...found.inquiries.flatMap((r) => phoneVariants(r.phone)), ...found.submissions.flatMap((r) => phoneVariants(r.phone))])];
  const allEmails = [...new Set([...(email ? [email] : []), ...found.inquiries.flatMap((r) => (r.email ? [normalizeEmail(r.email)] : []))])];
  const needles = [...allPhones, ...allEmails].map((v) => `"${v}"`); // quoted: whole JSON strings only

  const counts = await prisma.$transaction(async (tx) => {
    if (inqIds.length) await tx.inquiry.updateMany({ where: { id: { in: inqIds } }, data: anonymizedInquiry(now) });
    if (subIds.length) await tx.propertySubmission.updateMany({ where: { id: { in: subIds } }, data: anonymizedSubmission(now) });
    const notifications = await tx.$executeRaw`
      DELETE FROM "NotificationLog"
      WHERE recipient = ANY(${allPhones}::text[])
         OR string_to_array(lower(recipient), ', ') && ${allEmails}::text[]`;
    // Messages still waiting to be sent (or failed) carry the details in their payload.
    const jobs = await tx.$executeRaw`
      DELETE FROM "Job" WHERE type IN ('send_email', 'send_sms') AND status <> 'RUNNING'
        AND EXISTS (SELECT 1 FROM unnest(${needles}::text[]) n WHERE strpos(lower(payload::text), n) > 0)`;
    const auditEntries = (await scrubLeadAudit(tx, "Inquiry", inqIds)) + (await scrubLeadAudit(tx, "PropertySubmission", subIds));
    const c = { inquiries: inqIds.length, submissions: subIds.length, notifications, pendingMessages: jobs, auditEntries };
    await audit(req, { action: "privacy.erase", entityType: "Privacy", after: { subject: describe(s), ...c } }, tx);
    return c;
  });
  return counts;
}
