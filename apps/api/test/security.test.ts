import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/prisma";
import { saveIpAllowlist } from "../src/lib/securitySettings";
import { app, createUser, loginAs, PASSWORD, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const login = (agent: ReturnType<typeof request.agent>, email: string, password = PASSWORD) => agent.post("/api/admin/auth/login").send({ email, password });

describe("sign-in (email and password only)", () => {
  it("every role signs in with email and password alone — no code step, no setup step", async () => {
    for (const role of ["SUPER_ADMIN", "CONTENT_ADMIN", "MODERATOR"] as const) {
      const u = await createUser(role);
      const agent = request.agent(app);
      const res = await login(agent, u.email);
      expect(res.status).toBe(200);
      expect(res.body.restriction).toBe("NONE");
      expect(res.body.mfaRequired).toBeUndefined();
      expect((await agent.get("/api/admin/auth/me")).body.security).toEqual({ passwordChangedAt: null, sessionIdleMinutes: 60 });
    }
  });

  it("the old two-step endpoints are gone", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    for (const path of ["/2fa/setup", "/2fa/enable", "/2fa/disable", "/2fa/backup-codes", "/2fa/verify"]) {
      expect((await agent.post(`/api/admin/auth${path}`).send({ code: "123456" })).status).toBe(404);
    }
    expect((await agent.put("/api/admin/security/policy").send({ require2faForAll: true })).status).toBe(404);
  });
});

describe("brute-force protection", () => {
  it("locks the account on the 5th wrong password; even the right password is refused while locked", async () => {
    const u = await createUser("CONTENT_ADMIN");
    for (let i = 1; i <= 4; i++) expect((await login(request.agent(app), u.email, "wrong")).status).toBe(401);
    const fifth = await login(request.agent(app), u.email, "wrong");
    expect(fifth.status).toBe(423);
    expect(fifth.body.error.code).toBe("ACCOUNT_LOCKED");
    expect((await login(request.agent(app), u.email)).status).toBe(423);
    expect(await prisma.auditLog.count({ where: { action: "auth.locked" } })).toBe(1);

    const { agent } = await loginAs("SUPER_ADMIN");
    await agent.post(`/api/admin/team/${u.id}/unlock`);
    expect((await login(request.agent(app), u.email)).status).toBe(200);
  });

  it("unknown emails get the same answer as wrong passwords", async () => {
    const res = await login(request.agent(app), "nobody@test.local", "whatever");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toBe("Email or password is incorrect.");
  });

  it("old low-cost password hashes are upgraded at sign-in", async () => {
    const u = await prisma.user.create({ data: { email: "old@test.local", name: "Old", role: "MODERATOR", passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    expect((await login(request.agent(app), u.email)).status).toBe(200);
    const { passwordHash } = await prisma.user.findUniqueOrThrow({ where: { id: u.id } });
    expect(passwordHash).toMatch(/^\$2[ab]\$10\$/);
  });
});

describe("passwords", () => {
  it("new staff must replace the temporary password before doing anything", async () => {
    const { agent: owner } = await loginAs("SUPER_ADMIN");
    const created = await owner.post("/api/admin/team").send({ email: "sara@test.local", name: "Sara Nabil", role: "CONTENT_ADMIN", password: "Temp-Garden-Lamp-42" });
    expect(created.status).toBe(201);
    expect(created.body.data.mustChangePassword).toBe(true);

    const sara = request.agent(app);
    expect((await login(sara, "sara@test.local", "Temp-Garden-Lamp-42")).body.restriction).toBe("PASSWORD_CHANGE");
    expect((await sara.get("/api/admin/inquiries")).body.error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    const weak = await sara.post("/api/admin/auth/password").send({ currentPassword: "Temp-Garden-Lamp-42", newPassword: "Sara-Password-1!" });
    expect(weak.status).toBe(400);
    const ok = await sara.post("/api/admin/auth/password").send({ currentPassword: "Temp-Garden-Lamp-42", newPassword: "Nile-Balcony-Tram-77" });
    expect(ok.status).toBe(200);
    expect((await sara.get("/api/admin/inquiries")).status).toBe(200);
  });

  it("the team form enforces the password policy too", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    const res = await agent.post("/api/admin/team").send({ email: "x@test.local", name: "X Person", role: "MODERATOR", password: "Brookrege2026!!" });
    expect(res.status).toBe(400);
  });

  it("changing your password signs out your other browsers", async () => {
    const u = await createUser("CONTENT_ADMIN");
    const a = request.agent(app), b = request.agent(app);
    await login(a, u.email); await login(b, u.email);
    expect((await a.post("/api/admin/auth/password").send({ currentPassword: PASSWORD, newPassword: "Nile-Balcony-Tram-77" })).status).toBe(200);
    expect((await a.get("/api/admin/inquiries")).status).toBe(200);
    expect((await b.get("/api/admin/inquiries")).status).toBe(401);
  });
});

describe("sessions", () => {
  it("ends after 60 minutes without activity", async () => {
    const { agent, user } = await loginAs("CONTENT_ADMIN");
    await prisma.adminSession.updateMany({ where: { userId: user.id }, data: { lastSeenAt: new Date(Date.now() - 61 * 60_000) } });
    const res = await agent.get("/api/admin/properties");
    expect(res.status).toBe(401);
    expect(res.body.error.message).toMatch(/60 minutes/);
    expect((await agent.post("/api/admin/auth/refresh")).status).toBe(401); // can't be revived with the refresh token
  });

  it("a revoked session stops working immediately, not 15 minutes later", async () => {
    const { agent: owner } = await loginAs("SUPER_ADMIN");
    const { agent: mona, user } = await loginAs("CONTENT_ADMIN");
    expect((await mona.get("/api/admin/properties")).status).toBe(200);
    const sessions = (await owner.get("/api/admin/security/sessions")).body.data;
    const hers = sessions.find((s: { user: { id: string } }) => s.user.id === user.id);
    expect((await owner.delete(`/api/admin/security/sessions/${hers.id}`)).status).toBe(204);
    expect((await mona.get("/api/admin/properties")).status).toBe(401);
  });

  it("role changes apply at once (role is read from the database)", async () => {
    const { agent, user } = await loginAs("CONTENT_ADMIN");
    await prisma.user.update({ where: { id: user.id }, data: { role: "MODERATOR" } }); // bypasses the API's own sign-out
    expect((await agent.delete("/api/admin/properties/any")).status).toBe(403);
  });
});

describe("network protections", () => {
  it("IP allowlist: can't lock yourself out; other networks are refused; public site unaffected", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    const lockout = await agent.put("/api/admin/security/ip-allowlist").send({ enabled: true, entries: [{ value: "10.9.9.9" }] });
    expect(lockout.status).toBe(400);
    expect(lockout.body.error.message).toMatch(/lock you out/);

    await saveIpAllowlist({ enabled: true, entries: [{ value: "10.9.9.9" }] }); // as if saved from the office
    const blocked = await agent.get("/api/admin/properties");
    expect(blocked.body.error.code).toBe("IP_NOT_ALLOWED");
    expect((await request(app).get("/api/regions")).status).toBe(200);

    await saveIpAllowlist({ enabled: true, entries: [{ value: "127.0.0.1" }, { value: "::1" }] });
    expect((await agent.get("/api/admin/properties")).status).toBe(200);
  });

  it("admin changes are refused from any origin but the admin app", async () => {
    const { agent } = await loginAs("CONTENT_ADMIN");
    const evil = await agent.post("/api/admin/auth/sessions/revoke-others").set("Origin", "https://evil.example");
    expect(evil.body.error.code).toBe("BAD_ORIGIN");
    const publicSite = await agent.post("/api/admin/auth/sessions/revoke-others").set("Origin", "http://localhost:3000");
    expect(publicSite.status).toBe(403);
    const crossSite = await agent.post("/api/admin/auth/sessions/revoke-others").set("Sec-Fetch-Site", "same-site");
    expect(crossSite.status).toBe(403);
    expect((await agent.post("/api/admin/auth/sessions/revoke-others").set("Origin", "http://localhost:3001")).status).toBe(200);
  });

  it("CORS: the public site's origin can't read admin responses", async () => {
    const res = await request(app).get("/api/admin/auth/me").set("Origin", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    const adminRes = await request(app).get("/api/admin/auth/me").set("Origin", "http://localhost:3001");
    expect(adminRes.headers["access-control-allow-origin"]).toBe("http://localhost:3001");
    expect(adminRes.headers["access-control-allow-credentials"]).toBe("true");
  });
});

describe("activity log", () => {
  it("is append-only at the database level", async () => {
    await loginAs("CONTENT_ADMIN");
    expect(await prisma.auditLog.count()).toBeGreaterThan(0);
    await expect(prisma.auditLog.updateMany({ data: { action: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditLog.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it("security overview is for super admins only", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    const o = await agent.get("/api/admin/security/overview");
    expect(o.status).toBe(200);
    expect(o.body.data.counts.staff).toBe(1);
    expect(o.body.data.counts).not.toHaveProperty("with2fa");
    expect(o.body.data.checks.length).toBeGreaterThan(3);
    const { agent: content } = await loginAs("CONTENT_ADMIN");
    expect((await content.get("/api/admin/security/overview")).status).toBe(403);
  });
});
