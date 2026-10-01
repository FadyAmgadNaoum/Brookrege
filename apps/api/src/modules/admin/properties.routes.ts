import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import {
  LISTING_STATUSES,
  PROPERTY_TYPES,
  SELLER_TYPES,
  TRANSACTION_TYPES,
  computeExpiry,
  validateListing,
} from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { serializeProperty } from "../../lib/serialize";
import { getListingDurationMonths } from "../../lib/settings";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { keyFromUrl, storage } from "../../storage/storage";
import { attachToProperty, ingestAll, uploadMiddleware } from "../media/media.routes";
import { buildWhere, listQueryBase, orderBy } from "../public/propertyQuery";

export const adminPropertiesRouter = Router();

const nullableInt = z.coerce.number().int().min(0).max(50).nullable().optional();

const propertyBody = z.object({
  title: z.string().trim().min(5).max(160),
  titleEn: z.string().trim().max(160).nullable().optional(),
  description: z.string().trim().max(5000).nullable().optional(),
  descriptionEn: z.string().trim().max(5000).nullable().optional(),
  type: z.enum(PROPERTY_TYPES),
  transaction: z.enum(TRANSACTION_TYPES),
  sellerType: z.enum(SELLER_TYPES).nullable().optional(),
  price: z.coerce.number().positive().max(10_000_000_000),
  areaSqm: z.coerce.number().int().positive().max(1_000_000),
  bedrooms: nullableInt,
  bathrooms: nullableInt,
  regionId: z.string().min(1),
  compoundId: z.string().min(1).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
  latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
  longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
  isFeatured: z.boolean().optional(),
  /** Create as DRAFT (default) or publish immediately. */
  publish: z.boolean().optional(),
});

const propertyPatch = propertyBody.omit({ publish: true }).partial();
const idParam = z.object({ id: z.string().min(1).max(40) });

function assertRules(input: z.infer<typeof propertyBody>) {
  const violations = validateListing({
    type: input.type,
    transaction: input.transaction,
    sellerType: input.sellerType ?? null,
    bedrooms: input.bedrooms ?? null,
    bathrooms: input.bathrooms ?? null,
    price: input.price,
    areaSqm: input.areaSqm,
  });
  if (violations.length) {
    const details = Object.fromEntries(violations.map((v) => [v.field, [v.message]]));
    throw badRequest(violations[0]!.message, details);
  }
}

async function assertCompoundInRegion(compoundId: string | null | undefined, regionId: string) {
  if (!compoundId) return;
  const c = await prisma.compound.findUnique({ where: { id: compoundId }, select: { regionId: true } });
  if (!c) throw badRequest("Selected compound does not exist.");
  if (c.regionId !== regionId) throw badRequest("The compound is in a different region than the one selected.", { compoundId: ["Compound and region don't match."] });
}

// ---------- List (includes expired/drafts; admin-only) ----------
const adminListQuery = listQueryBase.extend({
  status: z.enum(LISTING_STATUSES).optional(),
  expiringInDays: z.coerce.number().int().min(1).max(60).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

adminPropertiesRouter.get(
  "/",
  requirePermission("property:read"),
  validate(adminListQuery, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof adminListQuery>(req, "query");
    const base: Prisma.PropertyWhereInput = { deletedAt: null };
    if (q.status) base.status = q.status;
    if (q.expiringInDays) {
      base.status = "ACTIVE";
      base.expiresAt = { gt: new Date(), lte: new Date(Date.now() + q.expiringInDays * 86_400_000) };
    }
    const where = buildWhere(q, base);
    const [total, rows] = await prisma.$transaction([
      prisma.property.count({ where }),
      prisma.property.findMany({
        where,
        orderBy: q.sort === "newest" ? [{ updatedAt: "desc" }] : orderBy(q.sort),
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        select: {
          id: true, title: true, type: true, transaction: true, sellerType: true, status: true, price: true, areaSqm: true,
          isFeatured: true, listedAt: true, expiresAt: true, updatedAt: true, viewCount: true,
          region: { select: { name: true } }, compound: { select: { name: true } },
          _count: { select: { inquiries: true, media: true } },
        },
      }),
    ]);
    res.json({ data: rows.map(serializeProperty), meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) } });
  }),
);

adminPropertiesRouter.get(
  "/:id",
  requirePermission("property:read"),
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const p = await prisma.property.findFirst({
      where: { id, deletedAt: null },
      include: { media: { orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { asset: true } }, region: true, compound: true, createdBy: { select: { name: true } }, updatedBy: { select: { name: true } } },
    });
    if (!p) throw notFound("Property");
    res.json({ data: serializeProperty(p) });
  }),
);

// ---------- Create / update ----------
adminPropertiesRouter.post(
  "/",
  requirePermission("property:write"),
  validate(propertyBody),
  asyncHandler(async (req, res) => {
    const { publish, ...input } = parsed<typeof propertyBody>(req, "body");
    assertRules(input);
    await assertCompoundInRegion(input.compoundId, input.regionId);
    const now = new Date();
    const lifecycle = publish ? { status: "ACTIVE" as const, listedAt: now, expiresAt: computeExpiry(now, await getListingDurationMonths()) } : {};
    const created = await prisma.$transaction(async (tx) => {
      const p = await tx.property.create({ data: { ...input, sellerType: input.transaction === "RENT" ? null : input.sellerType, ...lifecycle, createdById: req.user!.id, updatedById: req.user!.id } });
      await audit(req, { action: "property.create", entityType: "Property", entityId: p.id, after: p }, tx);
      return p;
    });
    res.status(201).json({ data: serializeProperty(created) });
  }),
);

adminPropertiesRouter.patch(
  "/:id",
  requirePermission("property:write"),
  validate(idParam, "params"),
  validate(propertyPatch),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const patch = parsed<typeof propertyPatch>(req, "body");
    const before = await prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound("Property");

    // Validate the merged result, not just the patch.
    const merged = { ...serializeProperty(before), ...patch } as z.infer<typeof propertyBody>;
    assertRules(merged);
    await assertCompoundInRegion(merged.compoundId, merged.regionId);
    if (merged.transaction === "RENT") patch.sellerType = null;

    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.property.update({ where: { id }, data: { ...patch, updatedById: req.user!.id } });
      await audit(req, { action: "property.update", entityType: "Property", entityId: id, before, after: p }, tx);
      return p;
    });
    res.json({ data: serializeProperty(updated) });
  }),
);

// ---------- Lifecycle ----------
const lifecycleBody = z.object({ action: z.enum(["publish", "renew", "expire", "mark_sold", "archive", "unpublish"]) });

/**
 * publish / renew : ACTIVE, expires in N months from now (N from settings, default 3)
 * expire          : EXPIRED now (hidden from public, visible to admin)
 * mark_sold       : SOLD (can feed the "completed / sold" section)
 * archive         : ARCHIVED; unpublish : back to DRAFT
 */
adminPropertiesRouter.post(
  "/:id/lifecycle",
  requirePermission("property:lifecycle"),
  validate(idParam, "params"),
  validate(lifecycleBody),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const { action } = parsed<typeof lifecycleBody>(req, "body");
    const before = await prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound("Property");
    const now = new Date();
    let data: Prisma.PropertyUpdateInput;
    switch (action) {
      case "publish":
      case "renew":
        data = { status: "ACTIVE", listedAt: before.listedAt ?? now, expiresAt: computeExpiry(now, await getListingDurationMonths()) };
        break;
      case "expire":
        data = { status: "EXPIRED", expiresAt: now };
        break;
      case "mark_sold":
        data = { status: "SOLD", soldAt: now };
        break;
      case "archive":
        data = { status: "ARCHIVED" };
        break;
      case "unpublish":
        data = { status: "DRAFT" };
        break;
      default: {
        const never: never = action;
        throw badRequest(`Unknown action ${String(never)}`);
      }
    }
    const updated = await prisma.$transaction(async (tx) => {
      const p = await tx.property.update({ where: { id }, data: { ...data, updatedBy: { connect: { id: req.user!.id } } } });
      await audit(req, { action: `property.${action}`, entityType: "Property", entityId: id, before: { status: before.status, expiresAt: before.expiresAt }, after: { status: p.status, expiresAt: p.expiresAt } }, tx);
      return p;
    });
    res.json({ data: serializeProperty(updated) });
  }),
);

adminPropertiesRouter.delete(
  "/:id",
  requirePermission("property:delete"),
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const before = await prisma.property.findFirst({ where: { id, deletedAt: null } });
    if (!before) throw notFound("Property");
    await prisma.$transaction(async (tx) => {
      await tx.property.update({ where: { id }, data: { deletedAt: new Date(), status: "ARCHIVED", updatedById: req.user!.id } });
      await audit(req, { action: "property.delete", entityType: "Property", entityId: id, before }, tx);
    });
    res.status(204).end();
  }),
);

// ---------- Media (Phase 2: every file is a library asset; see modules/media) ----------
adminPropertiesRouter.post(
  "/:id/media",
  requirePermission("property:write"),
  validate(idParam, "params"),
  uploadMiddleware,
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (!files.length) throw badRequest("Choose at least one photo or video.");
    const exists = await prisma.property.findFirst({ where: { id, deletedAt: null }, select: { id: true } });
    if (!exists) throw notFound("Property");
    const results = await ingestAll(files, req.user!.id);
    const assets = results.flatMap((r) => (r.ok ? [r.asset] : []));
    const errors = results.flatMap((r) => (r.ok ? [] : [{ file: r.file, message: r.message }]));
    if (assets.length) await attachToProperty(id, assets.map((a) => a.id));
    await audit(req, { action: "property.media_upload", entityType: "Property", entityId: id, after: { uploaded: assets.length, failed: errors.length } });
    const media = await prisma.propertyMedia.findMany({ where: { propertyId: id }, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }], include: { asset: true } });
    res.status(assets.length ? 201 : 400).json({ data: media, errors });
  }),
);

const attachBody = z.object({ assetIds: z.array(z.string().min(1).max(40)).min(1).max(50) });

/** Add existing library files to a listing. */
adminPropertiesRouter.post(
  "/:id/media/attach",
  requirePermission("property:write"),
  validate(idParam, "params"),
  validate(attachBody),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const added = await attachToProperty(id, parsed<typeof attachBody>(req, "body").assetIds);
    await audit(req, { action: "property.media_attach", entityType: "Property", entityId: id, after: { added } });
    res.status(201).json({ data: { added } });
  }),
);

const mediaParams = z.object({ id: z.string().min(1), mediaId: z.string().min(1) });

adminPropertiesRouter.post(
  "/:id/media/:mediaId/cover",
  requirePermission("property:write"),
  validate(mediaParams, "params"),
  asyncHandler(async (req, res) => {
    const { id, mediaId } = parsed<typeof mediaParams>(req, "params");
    await prisma.$transaction([
      prisma.propertyMedia.updateMany({ where: { propertyId: id }, data: { isCover: false } }),
      prisma.propertyMedia.update({ where: { id: mediaId, propertyId: id }, data: { isCover: true } }),
    ]);
    res.status(204).end();
  }),
);

adminPropertiesRouter.delete(
  "/:id/media/:mediaId",
  requirePermission("property:write"),
  validate(mediaParams, "params"),
  asyncHandler(async (req, res) => {
    const { id, mediaId } = parsed<typeof mediaParams>(req, "params");
    const m = await prisma.propertyMedia.findFirst({ where: { id: mediaId, propertyId: id } });
    if (!m) throw notFound("Image");
    await prisma.propertyMedia.delete({ where: { id: mediaId } });
    // Phase 1 files (no library asset) are removed from storage; library files stay in the media library.
    if (!m.assetId) {
      const key = keyFromUrl(m.url);
      if (key) await storage.removePrefix(key).catch(() => undefined);
    }
    await audit(req, { action: "property.media_delete", entityType: "Property", entityId: id, before: { url: m.url } });
    res.status(204).end();
  }),
);
