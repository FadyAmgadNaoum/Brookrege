import bcrypt from "bcryptjs";
import request from "supertest";
import type { Role } from "@brookrege/domain";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { clearSecuritySettingsCache } from "../src/lib/securitySettings";

export const app = createApp();
export const PASSWORD = "Test-Password-123!";

/** Wipes all tables. Tests run against a dedicated test database only. */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("test")) throw new Error("Refusing to reset a non-test database.");
  // TRUNCATE doesn't fire the activity log's append-only trigger (row-level UPDATE/DELETE only).
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditLog","RefreshToken","AdminSession","PropertyMedia","MediaAsset","PropertyViewDaily","Inquiry","PropertySubmission","Property",
             "Project","Compound","Region","ReportSchedule","Job","NotificationTemplate","NotificationLog","User","Setting" RESTART IDENTITY CASCADE`);
  clearSecuritySettingsCache();
}

export async function createUser(role: Role, email = `${role.toLowerCase()}@test.local`) {
  return prisma.user.create({ data: { email, name: role, role, passwordHash: await bcrypt.hash(PASSWORD, 10) } });
}

export async function loginAs(role: Role, email?: string) {
  const user = await createUser(role, email);
  const agent = request.agent(app);
  const res = await agent.post("/api/admin/auth/login").send({ email: user.email, password: PASSWORD });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

export async function region() {
  return prisma.region.create({ data: { name: "Sohag City", slug: "sohag-city" } });
}
