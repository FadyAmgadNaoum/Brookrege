import { Router } from "express";
import { z } from "zod";
import { nextReportRun, parseRange } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { dashboard, inquiriesReport, propertiesReport, teamReport } from "./analytics.service";
import { buildReport, REPORTS, toCsvFile, toXlsxFile } from "./reports";

export const adminAnalyticsRouter = Router();
adminAnalyticsRouter.use(requirePermission("analytics:read"));

const rangeQuery = z.object({ from: z.string().max(10).optional(), to: z.string().max(10).optional() });
const range = (req: unknown) => {
  const q = parsed<typeof rangeQuery>(req, "query");
  try { return parseRange(q.from, q.to); } catch (e) { throw badRequest((e as Error).message); }
};

adminAnalyticsRouter.get("/analytics/dashboard", validate(rangeQuery, "query"), asyncHandler(async (req, res) => { res.json({ data: await dashboard(range(req)) }); }));
adminAnalyticsRouter.get("/analytics/properties", validate(rangeQuery, "query"), asyncHandler(async (req, res) => { res.json({ data: await propertiesReport(range(req)) }); }));
adminAnalyticsRouter.get("/analytics/inquiries", validate(rangeQuery, "query"), asyncHandler(async (req, res) => { res.json({ data: await inquiriesReport(range(req)) }); }));
adminAnalyticsRouter.get("/analytics/users", validate(rangeQuery, "query"), asyncHandler(async (req, res) => { res.json({ data: await teamReport(range(req)) }); }));

const generateBody = z.object({ report: z.enum(REPORTS), from: z.string().max(10).optional(), to: z.string().max(10).optional(), format: z.enum(["csv", "xlsx"]) });

/** POST /admin/reports/generate → file download. (PDF: the admin's print view — see docs.) */
adminAnalyticsRouter.post("/reports/generate", validate(generateBody), asyncHandler(async (req, res) => {
  const b = parsed<typeof generateBody>(req, "body");
  let r;
  try { r = parseRange(b.from, b.to); } catch (e) { throw badRequest((e as Error).message); }
  const { tables } = await buildReport(b.report, r);
  const name = `brookrege-${b.report}-${r.from.toISOString().slice(0, 10)}_${r.to.toISOString().slice(0, 10)}`;
  const file = b.format === "csv" ? toCsvFile(tables) : await toXlsxFile(tables, name);
  await audit(req, { action: "report.export", entityType: "Report", entityId: b.report, after: { format: b.format, from: b.from, to: b.to } });
  res.setHeader("Content-Type", b.format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${name}.${b.format}"`);
  res.send(file);
}));

const scheduleBody = z.object({
  report: z.enum(REPORTS),
  frequency: z.enum(["WEEKLY", "MONTHLY"]),
  format: z.enum(["csv", "xlsx"]).default("xlsx"),
  recipients: z.array(z.string().trim().email()).min(1).max(10),
});

adminAnalyticsRouter.get("/reports/schedules", asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.reportSchedule.findMany({ orderBy: { createdAt: "desc" }, include: { createdBy: { select: { name: true } } } }) });
}));

adminAnalyticsRouter.post("/reports/schedules", validate(scheduleBody), asyncHandler(async (req, res) => {
  const b = parsed<typeof scheduleBody>(req, "body");
  const row = await prisma.reportSchedule.create({ data: { ...b, nextRunAt: nextReportRun(b.frequency, new Date()), createdById: req.user!.id } });
  await audit(req, { action: "report.schedule_create", entityType: "ReportSchedule", entityId: row.id, after: row });
  res.status(201).json({ data: row });
}));

const idParam = z.object({ id: z.string().min(1).max(40) });
adminAnalyticsRouter.delete("/reports/schedules/:id", validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.reportSchedule.findUnique({ where: { id } });
  if (!before) throw notFound("Schedule");
  await prisma.reportSchedule.delete({ where: { id } });
  await audit(req, { action: "report.schedule_delete", entityType: "ReportSchedule", entityId: id, before });
  res.status(204).end();
}));
