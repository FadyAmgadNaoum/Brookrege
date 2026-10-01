import { conversionRate, fillDailySeries, hoursBetween, percentChange, previousRange, type DateRange } from "@brookrege/domain";
import { readDb } from "../../lib/prisma";

// Analytics read from the replica when available: heavy queries never slow down writes.
const d = (x: Date) => x.toISOString().slice(0, 10);

async function viewsBetween(r: DateRange) {
  const rows = await readDb().$queryRaw<{ day: string; value: number }[]>`
    SELECT to_char(day, 'YYYY-MM-DD') AS day, SUM(views)::int AS value FROM "PropertyViewDaily"
    WHERE day BETWEEN ${d(r.from)}::date AND ${d(r.to)}::date GROUP BY day`;
  return rows;
}
async function inquiriesBetween(r: DateRange) {
  return readDb().$queryRaw<{ day: string; value: number }[]>`
    SELECT to_char("createdAt", 'YYYY-MM-DD') AS day, COUNT(*)::int AS value FROM "Inquiry"
    WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} AND status <> 'SPAM' GROUP BY 1`;
}
async function medianResponseHours(r: DateRange) {
  const rows = await readDb().$queryRaw<{ h: number | null }[]>`
    SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY (EXTRACT(EPOCH FROM ("firstResponseAt" - "createdAt")) / 3600)::float8) AS h
    FROM "Inquiry" WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} AND "firstResponseAt" IS NOT NULL`;
  return rows[0]?.h == null ? null : Math.round(rows[0].h * 10) / 10;
}
const sum = (rows: { value: number }[]) => rows.reduce((n, x) => n + x.value, 0);

async function periodTotals(r: DateRange) {
  const db = readDb();
  const [views, inquiries, newListings, sold, submissions, responseH] = await Promise.all([
    viewsBetween(r), inquiriesBetween(r),
    db.property.count({ where: { deletedAt: null, listedAt: { gte: r.from, lte: r.to } } }),
    db.property.count({ where: { soldAt: { gte: r.from, lte: r.to } } }),
    db.propertySubmission.count({ where: { createdAt: { gte: r.from, lte: r.to } } }),
    medianResponseHours(r),
  ]);
  return { views, inquiries, v: sum(views), i: sum(inquiries), newListings, sold, submissions, responseH };
}

const kpi = (value: number | null, previous: number | null) => ({ value, previous, change: value == null || previous == null ? null : percentChange(value, previous) });

export async function dashboard(r: DateRange) {
  const [cur, prev, live, byType, top] = await Promise.all([
    periodTotals(r), periodTotals(previousRange(r)),
    readDb().property.count({ where: { deletedAt: null, status: "ACTIVE", expiresAt: { gt: new Date() } } }),
    readDb().$queryRaw<{ type: string; live: number; inquiries: number }[]>`
      SELECT p.type::text AS type,
             COUNT(*) FILTER (WHERE p.status = 'ACTIVE' AND p."expiresAt" > now())::int AS live,
             COALESCE(SUM(ic.n), 0)::int AS inquiries
      FROM "Property" p
      LEFT JOIN (SELECT "propertyId", COUNT(*) AS n FROM "Inquiry" WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} AND status <> 'SPAM' GROUP BY "propertyId") ic
             ON ic."propertyId" = p.id
      WHERE p."deletedAt" IS NULL GROUP BY p.type ORDER BY live DESC`,
    topListings(r, 5),
  ]);
  return {
    range: { from: d(r.from), to: d(r.to), days: r.days },
    kpis: {
      liveListings: { value: live, previous: null, change: null },
      views: kpi(cur.v, prev.v),
      inquiries: kpi(cur.i, prev.i),
      conversionRate: kpi(conversionRate(cur.i, cur.v), conversionRate(prev.i, prev.v)),
      newListings: kpi(cur.newListings, prev.newListings),
      soldListings: kpi(cur.sold, prev.sold),
      submissions: kpi(cur.submissions, prev.submissions),
      medianResponseHours: kpi(cur.responseH, prev.responseH),
    },
    series: { views: fillDailySeries(r, cur.views), inquiries: fillDailySeries(r, cur.inquiries) },
    byType,
    topListings: top,
  };
}

export async function topListings(r: DateRange, limit = 50) {
  // Aggregate views and inquiries once, then join (a per-listing subquery took ~3 s at 40,000 listings).
  return readDb().$queryRaw<{ id: string; title: string; type: string; status: string; price: number; views: number; inquiries: number }[]>`
    WITH v AS (
      SELECT "propertyId", SUM(views)::int AS views FROM "PropertyViewDaily"
      WHERE day BETWEEN ${d(r.from)}::date AND ${d(r.to)}::date GROUP BY "propertyId"
    ), i AS (
      SELECT "propertyId", COUNT(*)::int AS n FROM "Inquiry"
      WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} AND status <> 'SPAM' AND "propertyId" IS NOT NULL GROUP BY "propertyId"
    )
    SELECT p.id, p.title, p.type::text AS type, p.status::text AS status, p.price::float8 AS price,
           COALESCE(v.views, 0)::int AS views, COALESCE(i.n, 0)::int AS inquiries
    FROM "Property" p
    LEFT JOIN v ON v."propertyId" = p.id
    LEFT JOIN i ON i."propertyId" = p.id
    WHERE p."deletedAt" IS NULL
    ORDER BY views DESC, inquiries DESC, p.id LIMIT ${limit}`;
}

export async function propertiesReport(r: DateRange) {
  const rows = await topListings(r, 1000);
  const [byRegion] = await Promise.all([
    readDb().$queryRaw<{ region: string; type: string; live: number; medianPrice: number | null }[]>`
      SELECT rg.name AS region, p.type::text AS type, COUNT(*)::int AS live,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY p.price::float8) AS "medianPrice"
      FROM "Property" p JOIN "Region" rg ON rg.id = p."regionId"
      WHERE p."deletedAt" IS NULL AND p.status = 'ACTIVE' AND p."expiresAt" > now() AND p.transaction = 'SALE'
      GROUP BY rg.name, p.type ORDER BY rg.name, p.type`,
  ]);
  return { listings: rows.map((x) => ({ ...x, conversionRate: conversionRate(x.inquiries, x.views) })), byRegion };
}

export async function inquiriesReport(r: DateRange) {
  const db = readDb();
  const [series, byStatus, responseH, list] = await Promise.all([
    inquiriesBetween(r),
    db.inquiry.groupBy({ by: ["status"], where: { createdAt: { gte: r.from, lte: r.to } }, _count: { _all: true } }),
    medianResponseHours(r),
    db.inquiry.findMany({ where: { createdAt: { gte: r.from, lte: r.to } }, orderBy: { createdAt: "desc" }, take: 5000,
      select: { createdAt: true, name: true, phone: true, status: true, firstResponseAt: true, property: { select: { title: true } } } }),
  ]);
  return {
    series: fillDailySeries(r, series),
    byStatus: Object.fromEntries(byStatus.map((g) => [g.status, g._count._all])),
    medianResponseHours: responseH,
    rows: list.map((x) => ({ ...x, responseHours: x.firstResponseAt ? hoursBetween(x.createdAt, x.firstResponseAt) : null })),
  };
}

/** "Users" = the staff team (the public site has no user accounts). Activity from the audit log. */
export async function teamReport(r: DateRange) {
  const rows = await readDb().$queryRaw<{ id: string; name: string; role: string; logins: number; listingChanges: number; leadUpdates: number; lastActive: Date | null }[]>`
    SELECT u.id, u.name, u.role::text AS role,
      COUNT(a.*) FILTER (WHERE a.action = 'auth.login')::int AS logins,
      COUNT(a.*) FILTER (WHERE a.action LIKE 'property.%')::int AS "listingChanges",
      COUNT(a.*) FILTER (WHERE a.action LIKE 'inquiry.%' OR a.action LIKE 'submission.%')::int AS "leadUpdates",
      MAX(a."createdAt") AS "lastActive"
    FROM "User" u LEFT JOIN "AuditLog" a ON a."actorId" = u.id AND a."createdAt" BETWEEN ${r.from} AND ${r.to}
    GROUP BY u.id ORDER BY "listingChanges" DESC`;
  return { team: rows };
}
