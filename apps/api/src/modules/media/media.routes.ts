import { Router } from "express";
import multer from "multer";
import { tmpdir } from "node:os";
import { z } from "zod";
import { MAX_FILES_PER_UPLOAD, MAX_VIDEO_BYTES } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, conflict, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { ingest, type UploadResult } from "./media.service";

export const adminMediaRouter = Router();

/** Files stream to a temp folder (not memory): a 95 MB video must not sit in the Node heap. */
export const uploadMiddleware = multer({ dest: tmpdir(), limits: { fileSize: MAX_VIDEO_BYTES, files: MAX_FILES_PER_UPLOAD } }).array("files", MAX_FILES_PER_UPLOAD);

/** Process files 3 at a time — fast, without starving web requests of CPU. */
export async function ingestAll(files: Express.Multer.File[], userId: string): Promise<UploadResult[]> {
  const results: UploadResult[] = new Array(files.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, files.length) }, async () => {
    while (next < files.length) {
      const i = next++;
      const f = files[i]!;
      results[i] = await ingest({ path: f.path, originalname: f.originalname, size: f.size }, userId);
    }
  }));
  return results;
}

/** Attach assets to a listing (keeps order; first image becomes cover if none). */
export async function attachToProperty(propertyId: string, assetIds: string[]) {
  const [property, assets] = await Promise.all([
    prisma.property.findFirst({ where: { id: propertyId, deletedAt: null }, select: { id: true, media: { select: { assetId: true, isCover: true, sortOrder: true } } } }),
    prisma.mediaAsset.findMany({ where: { id: { in: assetIds }, deletedAt: null } }),
  ]);
  if (!property) throw notFound("Property");
  const already = new Set(property.media.map((m) => m.assetId));
  const ordered = assetIds.map((id) => assets.find((a) => a.id === id)).filter((a): a is NonNullable<typeof a> => Boolean(a) && !already.has(a!.id));
  let sort = property.media.reduce((m, x) => Math.max(m, x.sortOrder), -1) + 1;
  let needCover = !property.media.some((m) => m.isCover);
  await prisma.propertyMedia.createMany({
    data: ordered.map((a) => {
      const isCover = needCover && a.kind === "IMAGE";
      if (isCover) needCover = false;
      return { propertyId, assetId: a.id, url: a.url, alt: a.alt, sortOrder: sort++, isCover };
    }),
  });
  return ordered.length;
}

const uploadQuery = z.object({ propertyId: z.string().max(40).optional() });

// POST /admin/media/upload — single or bulk (up to 20 files). Optional ?propertyId= attaches the results.
adminMediaRouter.post(
  "/upload",
  requirePermission("media:write"),
  validate(uploadQuery, "query"),
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest("Choose at least one photo or video.");
    const { propertyId } = parsed<typeof uploadQuery>(req, "query");
    const results = await ingestAll(files, req.user!.id);
    const assets = results.flatMap((r) => (r.ok ? [r.asset] : []));
    const errors = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, message: r.message }]));
    if (propertyId && assets.length) await attachToProperty(propertyId, assets.map((a) => a.id));
    await audit(req, { action: "media.upload", entityType: propertyId ? "Property" : "MediaAsset", entityId: propertyId ?? null, after: { uploaded: assets.length, failed: errors.length } });
    res.status(assets.length ? 201 : 400).json({ data: assets, errors });
  }),
);

const listQuery = z.object({
  kind: z.enum(["IMAGE", "VIDEO"]).optional(),
  unused: z.enum(["true"]).optional(),
  deleted: z.enum(["true"]).optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(48),
});

adminMediaRouter.get(
  "/",
  requirePermission("media:read"),
  validate(listQuery, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof listQuery>(req, "query");
    const where = {
      kind: q.kind,
      deletedAt: q.deleted ? { not: null } : null,
      ...(q.unused ? { usages: { none: {} } } : {}),
      ...(q.q ? { OR: [{ originalName: { contains: q.q, mode: "insensitive" as const } }, { alt: { contains: q.q, mode: "insensitive" as const } }] } : {}),
    };
    const [total, data] = await prisma.$transaction([
      prisma.mediaAsset.count({ where }),
      prisma.mediaAsset.findMany({
        where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize,
        include: { _count: { select: { usages: true } }, usages: { take: 3, select: { property: { select: { id: true, title: true } } } } },
      }),
    ]);
    res.json({ data, meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
  }),
);

const idParam = z.object({ id: z.string().min(1).max(40) });
const patchBody = z.object({ alt: z.string().trim().max(200).nullable() });

adminMediaRouter.patch(
  "/:id",
  requirePermission("media:write"),
  validate(idParam, "params"),
  validate(patchBody),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const { alt } = parsed<typeof patchBody>(req, "body");
    const asset = await prisma.mediaAsset.update({ where: { id }, data: { alt } });
    await prisma.propertyMedia.updateMany({ where: { assetId: id }, data: { alt } });
    res.json({ data: asset });
  }),
);

const delQuery = z.object({ force: z.enum(["true"]).optional() });

/** Soft delete (restorable for 30 days). In use → 409 unless ?force=true, which also removes it from listings. */
adminMediaRouter.delete(
  "/:id",
  requirePermission("media:write"),
  validate(idParam, "params"),
  validate(delQuery, "query"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const { force } = parsed<typeof delQuery>(req, "query");
    const asset = await prisma.mediaAsset.findUnique({ where: { id }, include: { _count: { select: { usages: true } } } });
    if (!asset || asset.deletedAt) throw notFound("File");
    if (asset._count.usages && !force) throw conflict(`This file is used in ${asset._count.usages} listing(s). Remove it from them first, or delete it everywhere.`);
    await prisma.$transaction([
      prisma.propertyMedia.deleteMany({ where: { assetId: id } }),
      prisma.mediaAsset.update({ where: { id }, data: { deletedAt: new Date() } }),
    ]);
    await audit(req, { action: "media.delete", entityType: "MediaAsset", entityId: id, before: { originalName: asset.originalName, usages: asset._count.usages } });
    res.status(204).end();
  }),
);

adminMediaRouter.post(
  "/:id/restore",
  requirePermission("media:write"),
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const asset = await prisma.mediaAsset.update({ where: { id }, data: { deletedAt: null } });
    res.json({ data: asset });
  }),
);
