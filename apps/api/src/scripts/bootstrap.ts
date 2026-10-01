/**
 * Production bootstrap: creates the first super admin and default settings. No sample data.
 * Usage (inside the api container):
 *   BOOTSTRAP_EMAIL=owner@brookrege.com BOOTSTRAP_PASSWORD='...' node dist/scripts/bootstrap.js
 */
import bcrypt from "bcryptjs";
import { DEFAULT_LISTING_DURATION_MONTHS } from "@brookrege/domain";
import { prisma } from "../lib/prisma";

async function main() {
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD ?? "";
  if (!email) throw new Error("Set BOOTSTRAP_EMAIL.");
  const strong = password.length >= 12 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password) && /[^A-Za-z0-9]/.test(password);
  if (!strong) throw new Error("BOOTSTRAP_PASSWORD needs 12+ chars with upper, lower, number and symbol.");

  if (await prisma.user.count({ where: { role: "SUPER_ADMIN" } })) {
    console.log("A super admin already exists — nothing to do. Add more people from Admin > Team.");
    return;
  }
  await prisma.user.create({ data: { email, name: "Owner", role: "SUPER_ADMIN", passwordHash: await bcrypt.hash(password, 12) } });
  await prisma.setting.upsert({
    where: { key: "listing_duration_months" },
    update: {},
    create: { key: "listing_duration_months", value: DEFAULT_LISTING_DURATION_MONTHS },
  });
  console.log(`Super admin created: ${email}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
