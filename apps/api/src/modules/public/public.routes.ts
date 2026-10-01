import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { PROPERTY_TYPES, TRANSACTION_TYPES, type PropertyType } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { prisma, readDb } from "../../lib/prisma";
import { notFound } from "../../lib/errors";
import { serializeProperty, toNumber } from "../../lib/serialize";
import { parsed, validate } from "../../middleware/validate";
import { events } from "../notifications/notify.service";
import { logger } from "../../lib/logger";
import { leadsCreated } from "../../metrics/registry";
import { cachedPublic } from "../../lib/appCache";
import { buildWhere, cardSelect, listQuerySchema, mediaSelect, orderBy, publicVisibility } from "./propertyQuery";

export const publicRouter = Router();

/** Crawlers, link previews and uptime monitors must not inflate view counts. */
const BOT_UA = /bot|crawl|spider|slurp|facebookexternalhit|whatsapp|telegram|preview|monitor|curl|wget|python-requests|headless/i;

const cache = (seconds: number) => `public, max-age=${seconds}, stale-while-revalidate=${seconds * 4}`;

/**
 * Server-side cache lifetimes (architecture: listings 1 h, search 30 min). Any admin change clears the cache
 * at once (lib/appCache.ts), so these only bound how long an entry lives if nothing changes. Listings that
 * reach their expiry date disappear within the search lifetime at most (the nightly job clears it too).
 */
const TTL = { search: 30 * 60, detail: 60 * 60, catalog: 60 * 60 };

// ---------- Properties ----------
publicRouter.get(
  "/properties",
  validate(listQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof listQuerySchema>(req, "query");
    const body = await cachedPublic(["properties", q], TTL.search, async () => {
      const where = buildWhere(q, publicVisibility());
      const db = readDb(); // one client per request: never mix replica and primary in a transaction
      const [total, rows] = await db.$transaction([
        db.property.count({ where }),
        db.property.findMany({ where, select: cardSelect, orderBy: orderBy(q.sort), skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
      ]);
      return {
        data: rows.map(serializeProperty),
        meta: { total, page: q.page, pageSize: q.pageSize, pageCount: Math.ceil(total / q.pageSize) },
      };
    });
    res.set("Cache-Control", cache(30)).json(body);
  }),
);

/**
 * Client requirement: cards by property type showing "starting from X EGP" and available unit count.
 * Accepts the same filters as the list, so it works globally, per region, or per compound.
 */
publicRouter.get(
  "/properties/summary",
  validate(listQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof listQuerySchema>(req, "query");
    const data = await cachedPublic(["summary", { ...q, type: undefined, page: 1, sort: "newest" }], TTL.search, async () => {
      const groups = await readDb().property.groupBy({
        by: ["type"],
        where: buildWhere({ ...q, type: undefined }, publicVisibility()),
        _min: { price: true },
        _count: { _all: true },
      });
      const byType = new Map(groups.map((g) => [g.type, g]));
      return PROPERTY_TYPES.filter((t) => byType.has(t)).map((type) => {
        const g = byType.get(type)!;
        return { type, startingFrom: toNumber(g._min.price), availableUnits: g._count._all };
      });
    });
    res.set("Cache-Control", cache(60)).json({ data });
  }),
);

publicRouter.get(
  "/properties/map",
  validate(listQuerySchema, "query"),
  asyncHandler(async (req, res) => {
    const q = parsed<typeof listQuerySchema>(req, "query");
    const data = await cachedPublic(["map", { ...q, page: 1, sort: "newest" }], TTL.search, async () => {
      const rows = await readDb().property.findMany({
        where: { AND: [buildWhere(q, publicVisibility()), { latitude: { not: null } }, { longitude: { not: null } }] },
        select: { id: true, title: true, titleEn: true, type: true, transaction: true, sellerType: true, price: true, latitude: true, longitude: true },
        take: 2000,
      });
      return rows.map(serializeProperty);
    });
    res.set("Cache-Control", cache(60)).json({ data });
  }),
);

const idParam = z.object({ id: z.string().min(1).max(40) });

publicRouter.get(
  "/properties/:id",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const data = await cachedPublic(["property", id], TTL.detail, async () => {
      const p = await readDb().property.findFirst({
        where: { id, ...publicVisibility() },
        select: {
          ...cardSelect,
          description: true,
          descriptionEn: true,
          address: true,
          latitude: true,
          longitude: true,
          media: { select: mediaSelect, orderBy: [{ isCover: "desc" }, { sortOrder: "asc" }] },
        },
      });
      return p ? serializeProperty(p) : null;
    });
    if (!data) throw notFound("Property");
    res.set("Cache-Control", cache(30)).json({ data });
  }),
);

/**
 * View counter, called by the listing page in the visitor's browser (a beacon), so pages and API responses
 * can be cached without losing counts. Bots and link previews are ignored; each browser counts once per
 * listing per 30 minutes (per server).
 */
const viewLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: false, legacyHeaders: false, message: { error: { code: "RATE_LIMITED", message: "Too many requests." } } });
const recentViews = new Map<string, number>();
publicRouter.post(
  "/properties/:id/view",
  viewLimiter,
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const ua = req.get("user-agent") ?? "";
    const key = `${req.ip}|${id}`;
    const last = recentViews.get(key) ?? 0;
    if (!BOT_UA.test(ua) && ua && Date.now() - last > 30 * 60_000) {
      recentViews.set(key, Date.now());
      if (recentViews.size > 50_000) recentViews.clear(); // bounded memory; worst case a few double counts
      const exists = await prisma.property.count({ where: { id, ...publicVisibility() } });
      if (exists) {
        // Fire-and-forget counters (total + per day for analytics); a failed increment must never fail anything.
        prisma.property.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => undefined);
        prisma.$executeRaw`
          INSERT INTO "PropertyViewDaily" ("propertyId", "day", "views") VALUES (${id}, CURRENT_DATE, 1)
          ON CONFLICT ("propertyId", "day") DO UPDATE SET "views" = "PropertyViewDaily"."views" + 1`.catch(() => undefined);
      }
    }
    res.status(204).set("Cache-Control", "no-store").end();
  }),
);

// ---------- Catalog ----------
publicRouter.get(
  "/regions",
  asyncHandler(async (_req, res) => {
    const data = await cachedPublic(["regions"], TTL.catalog, () =>
      readDb().region.findMany({ where: { isActive: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, nameAr: true, slug: true } }),
    );
    res.set("Cache-Control", cache(300)).json({ data });
  }),
);

publicRouter.get(
  "/compounds",
  asyncHandler(async (_req, res) => {
    const data = await cachedPublic(["compounds"], TTL.catalog, () => compoundSummaries());
    res.set("Cache-Control", cache(60)).json({ data });
  }),
);

async function compoundSummaries() {
  const db = readDb();
  const compounds = await db.compound.findMany({
    where: { isPublished: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, nameAr: true, slug: true, developerName: true, coverImageUrl: true, region: { select: { name: true, nameAr: true, slug: true } } },
  });
  const groups = await db.property.groupBy({
    by: ["compoundId", "type"],
    where: { ...publicVisibility(), compoundId: { in: compounds.map((c) => c.id) } },
    _min: { price: true },
    _count: { _all: true },
  });
  const data = compounds.map((c) => {
    const types = groups.filter((g) => g.compoundId === c.id);
    return {
      ...c,
      availableUnits: types.reduce((n, g) => n + g._count._all, 0),
      startingFrom: types.length ? Math.min(...types.map((g) => toNumber(g._min.price) ?? Infinity)) : null,
      types: types.map((g) => ({ type: g.type as PropertyType, startingFrom: toNumber(g._min.price), availableUnits: g._count._all })),
    };
  });
  return data;
}

const slugParam = z.object({ slug: z.string().min(1).max(80) });

publicRouter.get(
  "/compounds/:slug",
  validate(slugParam, "params"),
  asyncHandler(async (req, res) => {
    const { slug } = parsed<typeof slugParam>(req, "params");
    const c = await cachedPublic(["compound", slug], TTL.catalog, () =>
      readDb().compound.findFirst({
        where: { slug, isPublished: true },
        select: { id: true, name: true, nameAr: true, slug: true, developerName: true, description: true, descriptionEn: true, coverImageUrl: true, latitude: true, longitude: true, region: { select: { name: true, nameAr: true, slug: true } } },
      }),
    );
    if (!c) throw notFound("Compound");
    res.set("Cache-Control", cache(60)).json({ data: c });
  }),
);

const projectsQuery = z.object({ kind: z.enum(["PARTNERSHIP", "COMPLETED"]).optional() });

publicRouter.get(
  "/projects",
  validate(projectsQuery, "query"),
  asyncHandler(async (req, res) => {
    const { kind } = parsed<typeof projectsQuery>(req, "query");
    const data = await cachedPublic(["projects", kind ?? "all"], TTL.catalog, () =>
      readDb().project.findMany({
        where: { isPublished: true, kind },
        orderBy: [{ sortOrder: "asc" }, { completedAt: "desc" }],
        select: { id: true, kind: true, name: true, nameAr: true, slug: true, description: true, descriptionEn: true, partnerName: true, coverImageUrl: true, completedAt: true, region: { select: { name: true, nameAr: true } } },
      }),
    );
    res.set("Cache-Control", cache(120)).json({ data });
  }),
);

/**
 * Everything a search engine should index, with last-change dates (the website's /sitemap.xml). One cheap
 * query per kind instead of paging through the listing search. Capped at 22,500 listings: each has an Arabic
 * and an English page, and one sitemap file holds at most 50,000 URLs (apps/web/app/sitemap.ts).
 */
publicRouter.get(
  "/sitemap",
  asyncHandler(async (_req, res) => {
    const data = await cachedPublic(["sitemap"], TTL.catalog, async () => {
      const db = readDb();
      const [properties, compounds] = await db.$transaction([
        db.property.findMany({ where: publicVisibility(), select: { id: true, updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 22_500 }),
        db.compound.findMany({ where: { isPublished: true }, select: { slug: true, updatedAt: true }, orderBy: { sortOrder: "asc" } }),
      ]);
      return { properties, compounds };
    });
    res.set("Cache-Control", cache(600)).json({ data });
  }),
);

// ---------- Lead capture ----------
const leadLimiter = rateLimit({
  windowMs: 60 * 60_000,
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "RATE_LIMITED", message: "You've sent several requests already. Our team will contact you soon." } },
});

// Egyptian mobile (01x…) or international format. Normalized to digits with optional leading +.
const phone = z
  .string()
  .trim()
  .transform((v) => v.replace(/[\s\-()]/g, ""))
  .pipe(z.string().regex(/^(\+?\d{10,15}|01[0125]\d{8})$/, "Enter a valid phone number, for example 01012345678."));

const inquirySchema = z.object({
  propertyId: z.string().max(40).optional(),
  name: z.string().trim().min(2).max(100),
  phone,
  email: z.string().trim().email().max(200).optional().or(z.literal("").transform(() => undefined)),
  message: z.string().trim().max(2000).optional(),
  locale: z.enum(["ar", "en"]).default("ar"), // language for the customer's SMS acknowledgement
  website: z.string().max(0).optional(), // honeypot: real users never fill this hidden field
});

publicRouter.post(
  "/inquiries",
  leadLimiter,
  validate(inquirySchema),
  asyncHandler(async (req, res) => {
    const { website: _hp, propertyId, locale, ...body } = parsed<typeof inquirySchema>(req, "body");
    let propertyTitle: string | null = null;
    if (propertyId) {
      const p = await prisma.property.findFirst({ where: { id: propertyId, ...publicVisibility() }, select: { id: true, title: true, titleEn: true } });
      if (!p) throw notFound("Property");
      propertyTitle = locale === "en" ? p.titleEn || p.title : p.title;
    }
    const row = await prisma.inquiry.create({ data: { ...body, propertyId }, select: { id: true } });
    leadsCreated.inc({ kind: "inquiry" });
    events.inquiryCreated({ ...body, propertyTitle }, locale).catch((e) => logger.error("notify_inquiry_failed", { message: e.message }));
    res.status(201).json({ data: row });
  }),
);

const submissionSchema = z.object({
  ownerName: z.string().trim().min(2).max(100),
  phone,
  propertyType: z.enum(PROPERTY_TYPES).optional(),
  transaction: z.enum(TRANSACTION_TYPES).optional(),
  location: z.string().trim().max(200).optional(),
  details: z.string().trim().max(2000).optional(),
  locale: z.enum(["ar", "en"]).default("ar"),
  website: z.string().max(0).optional(),
});

/** "Add your property" — a simple contact request, reviewed by staff before anything is published. */
publicRouter.post(
  "/submissions",
  leadLimiter,
  validate(submissionSchema),
  asyncHandler(async (req, res) => {
    const { website: _hp, locale, ...data } = parsed<typeof submissionSchema>(req, "body");
    const row = await prisma.propertySubmission.create({ data, select: { id: true } });
    leadsCreated.inc({ kind: "submission" });
    events.submissionCreated(data, locale).catch((e) => logger.error("notify_submission_failed", { message: e.message }));
    res.status(201).json({ data: row });
  }),
);
