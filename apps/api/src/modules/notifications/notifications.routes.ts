import { Router } from "express";
import { z } from "zod";
import { renderTemplate, smsSegments, templateVariables } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { emailConfigSchema, getEmailConfig, getSmsConfig, publicEmail, publicSms, saveEmailConfig, saveSmsConfig, smsConfigSchema } from "./config";
import { queueEmail, queueSms } from "./notify.service";

export const adminNotificationsRouter = Router();
adminNotificationsRouter.use(requirePermission("notifications:manage"));

// Doc names: POST /admin/email-config, POST /admin/sms-config (+ GET to read, secrets masked)
adminNotificationsRouter.get("/email-config", asyncHandler(async (_req, res) => { res.json({ data: publicEmail(await getEmailConfig()) }); }));
adminNotificationsRouter.post("/email-config", validate(emailConfigSchema), asyncHandler(async (req, res) => {
  const data = await saveEmailConfig(parsed<typeof emailConfigSchema>(req, "body"));
  await audit(req, { action: "notifications.email_config", entityType: "Setting", entityId: "notifications.email", after: data });
  res.json({ data });
}));
adminNotificationsRouter.get("/sms-config", asyncHandler(async (_req, res) => { res.json({ data: publicSms(await getSmsConfig()) }); }));
adminNotificationsRouter.post("/sms-config", validate(smsConfigSchema), asyncHandler(async (req, res) => {
  const data = await saveSmsConfig(parsed<typeof smsConfigSchema>(req, "body"));
  await audit(req, { action: "notifications.sms_config", entityType: "Setting", entityId: "notifications.sms", after: data });
  res.json({ data });
}));

adminNotificationsRouter.get("/notifications/templates", asyncHandler(async (_req, res) => {
  const rows = await prisma.notificationTemplate.findMany({ orderBy: [{ key: "asc" }, { channel: "asc" }, { locale: "asc" }] });
  res.json({ data: rows.map((t) => ({ ...t, variables: templateVariables(`${t.subject ?? ""} ${t.body}`) })) });
}));

const templatePatch = z.object({ subject: z.string().max(200).nullable().optional(), body: z.string().min(1).max(5000), isActive: z.boolean().optional() });
const idParam = z.object({ id: z.string().min(1).max(40) });
adminNotificationsRouter.put("/notifications/templates/:id", validate(idParam, "params"), validate(templatePatch), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.notificationTemplate.findUnique({ where: { id } });
  if (!before) throw notFound("Template");
  const after = await prisma.notificationTemplate.update({ where: { id }, data: parsed<typeof templatePatch>(req, "body") });
  await audit(req, { action: "notifications.template_update", entityType: "NotificationTemplate", entityId: id, before, after });
  res.json({ data: after });
}));

const previewBody = z.object({ subject: z.string().max(200).optional(), body: z.string().max(5000), channel: z.enum(["EMAIL", "SMS"]), vars: z.record(z.string().max(500)).default({}) });
adminNotificationsRouter.post("/notifications/templates/preview", validate(previewBody), asyncHandler(async (req, res) => {
  const b = parsed<typeof previewBody>(req, "body");
  const body = renderTemplate(b.body, b.vars);
  res.json({ data: { subject: b.subject ? renderTemplate(b.subject, b.vars).text : null, body: body.text, missing: body.missing, sms: b.channel === "SMS" ? smsSegments(body.text) : null } });
}));

const logsQuery = z.object({
  channel: z.enum(["EMAIL", "SMS"]).optional(), status: z.enum(["SENT", "FAILED", "SKIPPED"]).optional(),
  page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(50),
});
adminNotificationsRouter.get("/notifications/logs", validate(logsQuery, "query"), asyncHandler(async (req, res) => {
  const q = parsed<typeof logsQuery>(req, "query");
  const where = { channel: q.channel, status: q.status };
  const [total, data] = await prisma.$transaction([
    prisma.notificationLog.count({ where }),
    prisma.notificationLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
  ]);
  res.json({ data, meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
}));

const testBody = z.object({ channel: z.enum(["EMAIL", "SMS"]), to: z.string().trim().min(5).max(200) });
/** Queues a real test message; the result appears in the logs within seconds. */
adminNotificationsRouter.post("/notifications/test", validate(testBody), asyncHandler(async (req, res) => {
  const b = parsed<typeof testBody>(req, "body");
  if (b.channel === "EMAIL") await queueEmail("test", [z.string().email().parse(b.to)], {}, "en");
  else await queueSms("test", b.to, {}, "en");
  await audit(req, { action: "notifications.test", entityType: "Notification", after: b });
  res.status(202).json({ data: { queued: true } });
}));

/** Background queue status — visible so staff can see stuck or failed jobs. */
adminNotificationsRouter.get("/jobs", asyncHandler(async (_req, res) => {
  const [counts, failed] = await Promise.all([
    prisma.job.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.job.findMany({ where: { status: "FAILED" }, orderBy: { finishedAt: "desc" }, take: 20, select: { id: true, type: true, attempts: true, lastError: true, finishedAt: true } }),
  ]);
  res.json({ data: { counts: Object.fromEntries(counts.map((c) => [c.status, c._count._all])), failed } });
}));
adminNotificationsRouter.post("/jobs/:id/retry", validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  await prisma.job.update({ where: { id, status: "FAILED" }, data: { status: "QUEUED", runAt: new Date(), attempts: 0, finishedAt: null } });
  res.json({ data: { requeued: true } });
}));
