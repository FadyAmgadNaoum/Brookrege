import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";

export const adminLeadsRouter = Router();

const page = { page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(25) };
const idParam = z.object({ id: z.string().min(1).max(40) });

// ---------- Inquiries (buyers contacting about a listing) ----------
const INQ = ["NEW", "CONTACTED", "VIEWING", "OFFERED", "CLOSED", "SPAM"] as const;
const inqQuery = z.object({ status: z.enum(INQ).optional(), ...page });

adminLeadsRouter.get(
  "/inquiries",
  requirePermission("inquiry:read"),
  validate(inqQuery, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof inqQuery>(req, "query");
    const where = { status: q.status };
    const [total, data] = await prisma.$transaction([
      prisma.inquiry.count({ where }),
      prisma.inquiry.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { property: { select: { id: true, title: true } } } }),
    ]);
    res.json({ data, meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
  }),
);

const inqPatch = z.object({ status: z.enum(INQ).optional(), staffNote: z.string().trim().max(2000).nullable().optional() });

adminLeadsRouter.patch(
  "/inquiries/:id",
  requirePermission("inquiry:write"),
  validate(idParam, "params"),
  validate(inqPatch),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const before = await prisma.inquiry.findUnique({ where: { id } });
    if (!before) throw notFound("Inquiry");
    const patch = parsed<typeof inqPatch>(req, "body");
    // First time an inquiry leaves NEW = first response (powers the "median response time" KPI).
    const firstResponseAt = !before.firstResponseAt && patch.status && patch.status !== "NEW" ? new Date() : undefined;
    const after = await prisma.inquiry.update({ where: { id }, data: { ...patch, ...(firstResponseAt ? { firstResponseAt } : {}) } });
    await audit(req, { action: "inquiry.update", entityType: "Inquiry", entityId: id, before: { status: before.status, staffNote: before.staffNote }, after: { status: after.status, staffNote: after.staffNote } });
    res.json({ data: after });
  }),
);

// ---------- Submissions ("Add your property") ----------
const SUB = ["NEW", "REVIEWED", "CONVERTED", "REJECTED"] as const;
const subQuery = z.object({ status: z.enum(SUB).optional(), ...page });

adminLeadsRouter.get(
  "/submissions",
  requirePermission("submission:read"),
  validate(subQuery, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof subQuery>(req, "query");
    const where = { status: q.status };
    const [total, data] = await prisma.$transaction([
      prisma.propertySubmission.count({ where }),
      prisma.propertySubmission.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    ]);
    res.json({ data, meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
  }),
);

const subPatch = z.object({ status: z.enum(SUB).optional(), staffNote: z.string().trim().max(2000).nullable().optional() });

adminLeadsRouter.patch(
  "/submissions/:id",
  requirePermission("submission:write"),
  validate(idParam, "params"),
  validate(subPatch),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const before = await prisma.propertySubmission.findUnique({ where: { id } });
    if (!before) throw notFound("Submission");
    const after = await prisma.propertySubmission.update({ where: { id }, data: parsed<typeof subPatch>(req, "body") });
    await audit(req, { action: "submission.update", entityType: "PropertySubmission", entityId: id, before: { status: before.status }, after: { status: after.status } });
    res.json({ data: after });
  }),
);
