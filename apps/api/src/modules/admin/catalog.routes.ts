import { Router } from "express";
import { z } from "zod";
import { slugify } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { conflict, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";

/** Regions, compounds, and projects (partnerships / completed). */
export const adminCatalogRouter = Router();

const idParam = z.object({ id: z.string().min(1).max(40) });
const optText = (max: number) => z.string().trim().max(max).nullable().optional();
const optCoord = (lim: number) => z.coerce.number().min(-lim).max(lim).nullable().optional();

// ---------- Regions ----------
const regionBody = z.object({ name: z.string().trim().min(2).max(80), nameAr: optText(80), sortOrder: z.coerce.number().int().optional(), isActive: z.boolean().optional() });

const regionPatch = regionBody.partial();

adminCatalogRouter.get("/regions", requirePermission("property:read"), asyncHandler(async (_req, res) => {
  const data = await prisma.region.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { _count: { select: { properties: true, compounds: true } } } });
  res.json({ data });
}));

adminCatalogRouter.post("/regions", requirePermission("catalog:write"), validate(regionBody), asyncHandler(async (req, res) => {
  const body = parsed<typeof regionBody>(req, "body");
  const row = await prisma.region.create({ data: { ...body, slug: slugify(body.name) } });
  await audit(req, { action: "region.create", entityType: "Region", entityId: row.id, after: row });
  res.status(201).json({ data: row });
}));

adminCatalogRouter.patch("/regions/:id", requirePermission("catalog:write"), validate(idParam, "params"), validate(regionPatch), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.region.findUnique({ where: { id } });
  if (!before) throw notFound("Region");
  const row = await prisma.region.update({ where: { id }, data: parsed<typeof regionPatch>(req, "body") });
  await audit(req, { action: "region.update", entityType: "Region", entityId: id, before, after: row });
  res.json({ data: row });
}));

// ---------- Compounds ----------
const compoundBody = z.object({
  name: z.string().trim().min(2).max(120),
  nameAr: optText(120),
  developerName: optText(120),
  description: optText(5000),
  descriptionEn: optText(5000),
  regionId: z.string().min(1),
  latitude: optCoord(90),
  longitude: optCoord(180),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const compoundPatch = compoundBody.partial();

adminCatalogRouter.get("/compounds", requirePermission("property:read"), asyncHandler(async (_req, res) => {
  const data = await prisma.compound.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }], include: { region: { select: { name: true } }, _count: { select: { properties: true } } } });
  res.json({ data });
}));

adminCatalogRouter.post("/compounds", requirePermission("catalog:write"), validate(compoundBody), asyncHandler(async (req, res) => {
  const body = parsed<typeof compoundBody>(req, "body");
  const row = await prisma.compound.create({ data: { ...body, slug: slugify(body.name) } });
  await audit(req, { action: "compound.create", entityType: "Compound", entityId: row.id, after: row });
  res.status(201).json({ data: row });
}));

adminCatalogRouter.patch("/compounds/:id", requirePermission("catalog:write"), validate(idParam, "params"), validate(compoundPatch), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.compound.findUnique({ where: { id } });
  if (!before) throw notFound("Compound");
  const row = await prisma.compound.update({ where: { id }, data: parsed<typeof compoundPatch>(req, "body") });
  await audit(req, { action: "compound.update", entityType: "Compound", entityId: id, before, after: row });
  res.json({ data: row });
}));

adminCatalogRouter.delete("/compounds/:id", requirePermission("catalog:write"), validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const inUse = await prisma.property.count({ where: { compoundId: id, deletedAt: null } });
  if (inUse) throw conflict(`This compound has ${inUse} listing(s). Move or delete them first.`);
  const before = await prisma.compound.delete({ where: { id } });
  await audit(req, { action: "compound.delete", entityType: "Compound", entityId: id, before });
  res.status(204).end();
}));

// ---------- Projects ----------
const projectBody = z.object({
  kind: z.enum(["PARTNERSHIP", "COMPLETED"]),
  name: z.string().trim().min(2).max(160),
  nameAr: optText(160),
  description: optText(5000),
  descriptionEn: optText(5000),
  partnerName: optText(160),
  regionId: z.string().min(1).nullable().optional(),
  coverImageUrl: z.string().url().max(500).nullable().optional(),
  completedAt: z.coerce.date().nullable().optional(),
  isPublished: z.boolean().optional(),
  sortOrder: z.coerce.number().int().optional(),
});

const projectPatch = projectBody.partial();

adminCatalogRouter.get("/projects", requirePermission("property:read"), asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.project.findMany({ orderBy: [{ kind: "asc" }, { sortOrder: "asc" }] }) });
}));

adminCatalogRouter.post("/projects", requirePermission("catalog:write"), validate(projectBody), asyncHandler(async (req, res) => {
  const body = parsed<typeof projectBody>(req, "body");
  const row = await prisma.project.create({ data: { ...body, slug: `${slugify(body.name)}-${Date.now().toString(36)}` } });
  await audit(req, { action: "project.create", entityType: "Project", entityId: row.id, after: row });
  res.status(201).json({ data: row });
}));

adminCatalogRouter.patch("/projects/:id", requirePermission("catalog:write"), validate(idParam, "params"), validate(projectPatch), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.project.findUnique({ where: { id } });
  if (!before) throw notFound("Project");
  const row = await prisma.project.update({ where: { id }, data: parsed<typeof projectPatch>(req, "body") });
  await audit(req, { action: "project.update", entityType: "Project", entityId: id, before, after: row });
  res.json({ data: row });
}));

adminCatalogRouter.delete("/projects/:id", requirePermission("catalog:write"), validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const before = await prisma.project.delete({ where: { id } });
  await audit(req, { action: "project.delete", entityType: "Project", entityId: id, before });
  res.status(204).end();
}));
