import bcrypt from "bcryptjs";
import request from "supertest";
import type { Role } from "@brookrege/domain";
import { createApp } from "../src/app";
import { prisma } from "../src/lib/prisma";
import { sealSecret } from "../src/lib/secrets";
import { clearSecuritySettingsCache } from "../src/lib/securitySettings";
import { generateTotpSecret, totpAt } from "../src/lib/totp";

export const app = createApp();
export const PASSWORD = "Test-Password-123!";

/** Wipes all tables. Tests run against a dedicated test database only. */
export async function resetDb() {
  if (!process.env.DATABASE_URL?.includes("test")) throw new Error("Refusing to reset a non-test database.");
  // TRUNCATE doesn't fire the activity log's append-only trigger (row-level UPDATE/DELETE only).
  await prisma.$executeRawUnsafe(`
    TRUNCATE "AuditLog","RefreshToken","AdminSession","BackupCode","PropertyMedia","MediaAsset","PropertyViewDaily","Inquiry","PropertySubmission","Property",
             "Project","Compound","Region","ReportSchedule","Job","NotificationTemplate","NotificationLog","User","Setting" RESTART IDENTITY CASCADE`);
  clearSecuritySettingsCache();
}

/**
 * Super admins are created with two-step verification switched on (so the sign-in tests cover the code step);
 * `totp` is the secret, for generating codes in tests.
 */
export async function createUser(role: Role, email = `${role.toLowerCase()}@test.local`, opts: { with2fa?: boolean } = {}) {
  const with2fa = opts.with2fa ?? role === "SUPER_ADMIN";
  const totp = with2fa ? generateTotpSecret() : null;
  const user = await prisma.user.create({
    data: {
      email, name: role, role, passwordHash: await bcrypt.hash(PASSWORD, 10),
      ...(totp ? { twoFactorEnabled: true, twoFactorEnabledAt: new Date(), totpSecret: sealSecret(totp) } : {}),
    },
  });
  return { ...user, totp };
}

export const codeFor = (totp: string, offsetSteps = 0) => totpAt(totp, Date.now() + offsetSteps * 30_000);

export async function loginAs(role: Role, email?: string) {
  const user = await createUser(role, email);
  const agent = request.agent(app);
  let res = await agent.post("/api/admin/auth/login").send({ email: user.email, password: PASSWORD });
  if (res.body.mfaRequired) res = await agent.post("/api/admin/auth/2fa/verify").send({ code: codeFor(user.totp!) });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, user };
}

export async function region() {
  return prisma.region.create({ data: { name: "Sohag City", slug: "sohag-city" } });
}
