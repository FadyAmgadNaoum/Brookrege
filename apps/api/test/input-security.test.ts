import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { prisma } from "../src/lib/prisma";
import { app, loginAs, region, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

// Classic payloads from the OWASP testing guide.
const SQLI = ["' OR '1'='1", "1; DROP TABLE \"Property\";--", "' UNION SELECT \"passwordHash\" FROM \"User\"--", "\\'; SELECT pg_sleep(5);--", "%' AND 1=1 AND '%'='"];
const XSS = ['<script>alert("x")</script>', '"><img src=x onerror=alert(1)>', "javascript:alert(1)", "<svg/onload=alert(1)>"];

describe("SQL injection (OWASP A03)", () => {
  it("search and filters treat payloads as plain text: no errors, no leaks, no delay", async () => {
    await region();
    for (const p of SQLI) {
      const started = Date.now();
      for (const url of [`/api/properties?q=${encodeURIComponent(p)}`, `/api/properties?region=${encodeURIComponent(p)}`, `/api/properties/summary?compound=${encodeURIComponent(p)}`, `/api/properties/${encodeURIComponent(p)}`]) {
        const res = await request(app).get(url);
        expect(res.status, `${url} → ${res.status}`).toBeLessThan(500);
        expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|\$2[ab]\$/);
      }
      expect(Date.now() - started).toBeLessThan(4000); // pg_sleep(5) never ran
    }
    expect(await prisma.property.count()).toBe(0); // table still there and untouched
  });

  it("enum-only parameters reject anything else", async () => {
    for (const url of ["/api/properties?sort=price;DROP", "/api/properties?type=APARTMENT'--", "/api/properties?transaction=SALE%27", "/api/projects?kind=x'"]) {
      expect((await request(app).get(url)).status).toBe(400);
    }
  });

  it("parameter tampering with objects/arrays (NoSQL-style operators) is refused", async () => {
    expect((await request(app).get("/api/properties?minPrice[gt]=0")).status).toBe(400);
    expect((await request(app).get("/api/properties?q[contains]=a")).status).toBe(400);
    expect((await request(app).post("/api/admin/auth/login").send({ email: { $ne: null }, password: { $ne: null } })).status).toBe(400);
  });
});

describe("cross-site scripting (OWASP A03)", () => {
  it("stores what visitors type as text; API responses can't be sniffed as HTML", async () => {
    for (const name of XSS) {
      const res = await request(app).post("/api/submissions").send({ ownerName: name.slice(0, 100), phone: "01012345678", details: name });
      expect(res.status).toBe(201);
      expect(res.headers["content-type"]).toMatch(/^application\/json/);
      expect(res.headers["x-content-type-options"]).toBe("nosniff");
    }
    const rows = await prisma.propertySubmission.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.details)).toEqual(XSS); // unchanged text — React escapes it when shown
  });
});

describe("request abuse", () => {
  it("prototype pollution through JSON bodies has no effect", async () => {
    const body = JSON.parse('{"ownerName":"Ali","phone":"01012345678","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}}}');
    expect((await request(app).post("/api/submissions").send(body)).status).toBe(201);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it("oversized bodies are refused before any work is done", async () => {
    const res = await request(app).post("/api/submissions").set("Content-Type", "application/json").send(JSON.stringify({ ownerName: "A", phone: "01012345678", details: "x".repeat(300_000) }));
    expect(res.status).toBe(413);
  });

  it("over-long fields are refused", async () => {
    expect((await request(app).post("/api/inquiries").send({ name: "A".repeat(5000), phone: "01012345678" })).status).toBe(400);
  });

  it("path traversal in IDs just finds nothing", async () => {
    for (const id of ["../../etc/passwd", "..%2F..%2Fetc%2Fpasswd", "a/../../b", "%E0%A4%A"]) {
      expect((await request(app).get(`/api/properties/${id}`)).status).toBeLessThan(500);
    }
  });

  it("mass assignment: fields that aren't in the form can't be set (status, view count, author)", async () => {
    const r = await region();
    const { agent } = await loginAs("CONTENT_ADMIN");
    const res = await agent.post("/api/admin/properties").send({
      title: "Test listing title", type: "APARTMENT", transaction: "SALE", sellerType: "RESALE", price: 1000000, areaSqm: 100, bedrooms: 2, regionId: r.id,
      status: "ACTIVE", viewCount: 99999, createdById: "someone-else", expiresAt: "2099-01-01", deletedAt: null,
    });
    expect(res.status).toBe(201);
    const p = await prisma.property.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(p.status).toBe("DRAFT");
    expect(p.viewCount).toBe(0);
    expect(p.expiresAt).toBeNull();
    expect(p.createdById).not.toBe("someone-else");
  });

  it("null bytes (which PostgreSQL can't store) get a clean 400, not a server error", async () => {
    expect((await request(app).get("/api/properties/%00")).status).toBe(400);
    expect((await request(app).get("/api/properties?q=a%00b")).status).toBe(400);
    expect((await request(app).post("/api/submissions").send({ ownerName: "A\u0000li", phone: "01012345678" })).status).toBe(400);
  });

  it("malformed JSON is a 400 with no internals", async () => {
    const res = await request(app).post("/api/submissions").set("Content-Type", "application/json").send('{"ownerName": "Ali", "phone": ');
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toMatch(/Unexpected|position|SyntaxError/);
  });

  it("error responses never include stack traces or SQL", async () => {
    const res = await request(app).get("/api/properties?page=999999999");
    expect(JSON.stringify(res.body)).not.toMatch(/at \w+ \(|prisma|SELECT|node_modules/i);
  });
});
