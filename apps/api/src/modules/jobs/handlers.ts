import type { Job } from "@prisma/client";
import { nextReportRun, parseRange } from "@brookrege/domain";
import { prisma } from "../../lib/prisma";
import { makeVideoThumbnail, cleanupMedia } from "../media/media.service";
import { deliverEmail, deliverSms, queueEmail, type Locale } from "../notifications/notify.service";
import { buildReport, toCsvFile, toXlsxFile, type ReportName } from "../analytics/reports";
import { pruneFinished } from "./queue";
import { runRetention } from "../privacy/privacy.service";

type Handler = (payload: Record<string, unknown>, job: Job) => Promise<unknown>;
const day = (d: Date) => d.toISOString().slice(0, 10);

export const handlers: Record<string, Handler> = {
  send_email: (p, job) => deliverEmail(p as Parameters<typeof deliverEmail>[0], job.id),
  send_sms: (p, job) => deliverSms(p as Parameters<typeof deliverSms>[0], job.id),
  video_thumbnail: (p) => makeVideoThumbnail(String(p.assetId), String(p.file)),

  /** Builds the report for the period that just ended and emails it as an attachment. */
  async scheduled_report(p) {
    const s = await prisma.reportSchedule.findUnique({ where: { id: String(p.scheduleId) } });
    if (!s || !s.isActive) return;
    const end = new Date(Date.now() - 86_400_000);
    const start = s.frequency === "WEEKLY" ? new Date(end.getTime() - 6 * 86_400_000) : new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1));
    const range = parseRange(day(start), day(end));
    const { tables, summary } = await buildReport(s.report as ReportName, range);
    const name = `brookrege-${s.report}-${day(range.from)}_${day(range.to)}`;
    const file = s.format === "csv" ? toCsvFile(tables) : await toXlsxFile(tables, name);
    await queueEmail("scheduled_report", s.recipients, { reportName: s.report, period: `${day(range.from)} → ${day(range.to)}`, summary }, "en", [
      { filename: `${name}.${s.format}`, contentBase64: file.toString("base64"), type: s.format === "csv" ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
    ]);
    await prisma.reportSchedule.update({ where: { id: s.id }, data: { lastRunAt: new Date() } });
  },

  /** Nightly personal-data retention (docs/security/PRIVACY.md). */
  privacy_retention: () => runRetention("schedule"),

  async media_cleanup() {
    await cleanupMedia();
    await pruneFinished();
  },

  /** Weekly email to staff listing everything that expires in the next 14 days. */
  async expiring_digest() {
    const soon = await prisma.property.findMany({
      where: { deletedAt: null, status: "ACTIVE", expiresAt: { gt: new Date(), lte: new Date(Date.now() + 14 * 86_400_000) } },
      orderBy: { expiresAt: "asc" }, select: { title: true, expiresAt: true },
    });
    if (!soon.length) return;
    const list = soon.map((x) => `• ${x.title} — ${day(x.expiresAt!)}`).join("\n");
    await queueEmail("expiring_digest", "staff", { count: soon.length, list }, "en" as Locale);
  },
};

/** Called every 15 min by the scheduler: claims due report schedules and queues them (no duplicates across servers). */
export async function queueDueReports() {
  return prisma.$transaction(async (tx) => {
    const due = await tx.$queryRaw<{ id: string; frequency: "WEEKLY" | "MONTHLY" }[]>`
      SELECT id, frequency::text AS frequency FROM "ReportSchedule"
      WHERE "isActive" AND "nextRunAt" <= now() FOR UPDATE SKIP LOCKED`;
    for (const s of due) {
      await tx.job.create({ data: { type: "scheduled_report", payload: { scheduleId: s.id } } });
      await tx.reportSchedule.update({ where: { id: s.id }, data: { nextRunAt: nextReportRun(s.frequency, new Date()) } });
    }
    return due.length;
  });
}
