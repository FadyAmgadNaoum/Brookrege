import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../lib/asyncHandler";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";

export const adminSystemRouter = Router();

adminSystemRouter.get("/dashboard", requirePermission("property:read"), asyncHandler(async (_req, res) => {
  const now = new Date();
  const in14 = new Date(now.getTime() + 14 * 86_400_000);
  const [byStatus, expiringSoon, newInquiries, newSubmissions] = await Promise.all([
    prisma.property.groupBy({ by: ["status"], where: { deletedAt: null }, _count: { _all: true } }),
    prisma.property.count({ where: { deletedAt: null, status: "ACTIVE", expiresAt: { gt: now, lte: in14 } } }),
    prisma.inquiry.count({ where: { status: "NEW" } }),
    prisma.propertySubmission.count({ where: { status: "NEW" } }),
  ]);
  res.json({
    data: {
      listings: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
      expiringSoon,
      newInquiries,
      newSubmissions,
    },
  });
}));

const auditQuery = z.object({
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  actorId: z.string().max(40).optional(),
  action: z.string().max(60).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

adminSystemRouter.get("/audit", requirePermission("audit:read"), validate(auditQuery, "query"), asyncHandler(async (req, res) => {
  const q = parsed<typeof auditQuery>(req, "query");
  const where = { entityType: q.entityType, entityId: q.entityId, actorId: q.actorId, action: q.action ? { startsWith: q.action } : undefined };
  const [total, data] = await prisma.$transaction([
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize, include: { actor: { select: { name: true, email: true } } } }),
  ]);
  res.json({ data, meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
}));
