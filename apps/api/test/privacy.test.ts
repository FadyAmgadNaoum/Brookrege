import { afterAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { REMOVED } from "@brookrege/domain";
import { prisma } from "../src/lib/prisma";
import { runRetention } from "../src/modules/privacy/privacy.service";
import { app, createUser, loginAs, resetDb } from "./setup";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const backdate = (table: "Inquiry" | "PropertySubmission" | "NotificationLog" | "AuditLog", id: string, months: number) =>
  prisma.$executeRawUnsafe(
    `UPDATE "${table}" SET ${table === "NotificationLog" || table === "AuditLog" ? `"createdAt"` : `"updatedAt"`} = now() - interval '${months} months' WHERE id = $1`,
    id,
  );

async function lead(phone = "01012345678", email = "ahmed@example.com") {
  return prisma.inquiry.create({ data: { name: "Ahmed", phone, email, message: "Is the flat still available?", staffNote: "Prefers evenings" } });
}

describe("who may handle personal-data requests", () => {
  it("only super admins", async () => {
    const { agent } = await loginAs("CONTENT_ADMIN");
    expect((await agent.get("/api/admin/privacy/overview")).status).toBe(403);
    expect((await agent.post("/api/admin/privacy/lookup").send({ phone: "01012345678" })).status).toBe(403);
    expect((await request(app).post("/api/admin/privacy/erase").send({ phone: "01012345678", confirm: "ERASE" })).status).toBe(401);
  });
});

describe("lookup, export and erasure", () => {
  it("finds a person's records whatever format the number was typed in", async () => {
    await lead("01012345678");
    await lead("+201012345678", "other@example.com");
    await prisma.propertySubmission.create({ data: { ownerName: "Ahmed", phone: "201012345678", details: "Villa" } });
    await lead("01099999999", "someone@example.com");
    const { agent } = await loginAs("SUPER_ADMIN");
    const res = await agent.post("/api/admin/privacy/lookup").send({ phone: "0020 101 234 5678" });
    expect(res.status).toBe(200);
    expect(res.body.data.inquiries).toHaveLength(2);
    expect(res.body.data.submissions).toHaveLength(1);
    const byEmail = await agent.post("/api/admin/privacy/lookup").send({ email: "AHMED@example.com" });
    expect(byEmail.body.data.inquiries).toHaveLength(1);
    expect((await agent.post("/api/admin/privacy/lookup").send({})).status).toBe(400);
    expect((await agent.post("/api/admin/privacy/lookup").send({ phone: "not a phone" })).status).toBe(400);
  });

  it("exports as a JSON download and records it (masked) in the activity log", async () => {
    await lead();
    const { agent } = await loginAs("SUPER_ADMIN");
    const res = await agent.post("/api/admin/privacy/export").send({ phone: "01012345678" });
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/attachment; filename="brookrege-personal-data-/);
    expect(res.body.inquiries[0].phone).toBe("01012345678");
    const log = await prisma.auditLog.findFirstOrThrow({ where: { action: "privacy.export" } });
    expect(JSON.stringify(log.after)).not.toContain("01012345678");
    expect(JSON.stringify(log.after)).toContain("010•••••678");
  });

  it("erasure needs the typed confirmation, then removes the details everywhere", async () => {
    const inq = await lead();
    const keep = await lead("01099999999", "someone@example.com");
    await prisma.notificationLog.create({ data: { channel: "SMS", recipient: "+201012345678", status: "SENT", provider: "test" } });
    await prisma.job.create({ data: { type: "send_sms", payload: { templateKey: "inquiry_customer_ack", phone: "01012345678", vars: {}, locale: "ar" } } });
    await prisma.job.create({ data: { type: "send_sms", payload: { templateKey: "inquiry_customer_ack", phone: "01099999999", vars: {}, locale: "ar" } } });
    const { agent } = await loginAs("SUPER_ADMIN");
    await agent.patch(`/api/admin/inquiries/${inq.id}`).send({ status: "CONTACTED", staffNote: "Called Ahmed on 01012345678" });

    expect((await agent.post("/api/admin/privacy/erase").send({ phone: "01012345678" })).status).toBe(400);
    const res = await agent.post("/api/admin/privacy/erase").send({ phone: "01012345678", confirm: "ERASE" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ inquiries: 1, notifications: 1, pendingMessages: 1 });

    const after = await prisma.inquiry.findUniqueOrThrow({ where: { id: inq.id } });
    expect(after).toMatchObject({ name: REMOVED, phone: REMOVED, email: null, message: null, staffNote: null, status: "CONTACTED" });
    expect(after.anonymizedAt).not.toBeNull();
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: keep.id } })).phone).toBe("01099999999");
    expect(await prisma.job.count()).toBe(1);
    // Past activity entries keep the status change but lose the note.
    const trail = await prisma.auditLog.findFirstOrThrow({ where: { action: "inquiry.update", entityId: inq.id } });
    expect(trail.after).toEqual({ status: "CONTACTED" });
    // Nothing left to find.
    const again = await agent.post("/api/admin/privacy/lookup").send({ phone: "01012345678" });
    expect(again.body.data.inquiries).toHaveLength(0);
    expect(await prisma.auditLog.count({ where: { action: "privacy.erase" } })).toBe(1);
  });
});

describe("retention", () => {
  it("anonymizes old leads, deletes old delivery logs and blanks old IP addresses — nothing recent", async () => {
    const old = await lead("01011111111");
    const recent = await lead("01022222222");
    const oldSub = await prisma.propertySubmission.create({ data: { ownerName: "Mona", phone: "01033333333" } });
    const oldLog = await prisma.notificationLog.create({ data: { channel: "SMS", recipient: "01011111111", status: "SENT", provider: "test" } });
    await prisma.notificationLog.create({ data: { channel: "SMS", recipient: "01022222222", status: "SENT", provider: "test" } });
    const oldAudit = await prisma.auditLog.create({ data: { action: "x.y", entityType: "X", ip: "203.0.113.5", userAgent: "UA" } });
    await prisma.auditLog.create({ data: { action: "x.z", entityType: "X", ip: "203.0.113.6", userAgent: "UA" } });
    await backdate("Inquiry", old.id, 25);
    await backdate("PropertySubmission", oldSub.id, 30);
    await backdate("NotificationLog", oldLog.id, 13);
    await prisma.$transaction([prisma.$executeRawUnsafe(`SET LOCAL brookrege.audit_maintenance = 'on'`), backdate("AuditLog", oldAudit.id, 13)]);
    const staff = await createUser("CONTENT_ADMIN");
    const monthsAgo = (m: number) => new Date(Date.now() - m * 31 * 86_400_000);
    await prisma.adminSession.create({ data: { userId: staff.id, ip: "203.0.113.7", expiresAt: monthsAgo(13), createdAt: monthsAgo(13), lastSeenAt: monthsAgo(13) } });
    await prisma.adminSession.create({ data: { userId: staff.id, ip: "203.0.113.8", expiresAt: new Date(Date.now() + 3_600_000) } });

    const run = await runRetention("manual");
    expect(run).toMatchObject({ inquiries: 1, submissions: 1, notificationLogs: 1, auditEntries: 1, sessions: 1 });
    expect(await prisma.adminSession.count()).toBe(1);
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: old.id } })).phone).toBe(REMOVED);
    expect((await prisma.inquiry.findUniqueOrThrow({ where: { id: recent.id } })).phone).toBe("01022222222");
    expect((await prisma.propertySubmission.findUniqueOrThrow({ where: { id: oldSub.id } })).ownerName).toBe(REMOVED);
    expect(await prisma.notificationLog.count()).toBe(1);
    expect((await prisma.auditLog.findUniqueOrThrow({ where: { id: oldAudit.id } })).ip).toBeNull();
    expect((await prisma.auditLog.findFirstOrThrow({ where: { action: "x.z" } })).ip).toBe("203.0.113.6");

    // Running again changes nothing.
    expect(await runRetention("manual")).toMatchObject({ inquiries: 0, submissions: 0, notificationLogs: 0, auditEntries: 0, sessions: 0 });
  });

  it("policy limits are enforced and changes are logged", async () => {
    const { agent } = await loginAs("SUPER_ADMIN");
    expect((await agent.put("/api/admin/privacy/policy").send({ leadRetentionMonths: 1, logRetentionMonths: 12 })).status).toBe(400);
    expect((await agent.put("/api/admin/privacy/policy").send({ leadRetentionMonths: 36, logRetentionMonths: 12 })).status).toBe(200);
    const o = await agent.get("/api/admin/privacy/overview");
    expect(o.body.data.policy).toEqual({ leadRetentionMonths: 36, logRetentionMonths: 12 });
    expect(await prisma.auditLog.count({ where: { action: "privacy.policy_update" } })).toBe(1);
  });
});
