/**
 * Encryption-key rotation (see docs/security/KEY-ROTATION.md):
 *   1. Set SETTINGS_ENCRYPTION_KEY=<new>  and  SETTINGS_ENCRYPTION_KEY_PREVIOUS=<old>, restart.
 *      (Everything keeps working: the old key is still accepted for reading.)
 *   2. Run:  node dist/scripts/rotateEncryptionKey.js
 *   3. Remove SETTINGS_ENCRYPTION_KEY_PREVIOUS and restart.
 * Re-encrypts: provider API keys (email/SMS settings) and every staff member's 2FA secret.
 * Safe to run twice — values already under the new key are skipped.
 */
import type { Prisma } from "@prisma/client";
import { env } from "../config/env";
import { prisma } from "../lib/prisma";
import { reseal } from "../lib/secretBox";

async function main() {
  const newKey = env.SETTINGS_ENCRYPTION_KEY;
  if (!newKey) throw new Error("SETTINGS_ENCRYPTION_KEY (the NEW key) is not set.");
  const old = [env.SETTINGS_ENCRYPTION_KEY_PREVIOUS];
  let changed = 0;

  for (const key of ["notifications.email", "notifications.sms"]) {
    const row = await prisma.setting.findUnique({ where: { key } });
    if (!row) continue;
    const value = { ...(row.value as Record<string, unknown>) };
    let touched = false;
    for (const field of ["apiKeySealed", "authTokenSealed"]) {
      const v = value[field];
      if (typeof v !== "string") continue;
      const next = reseal(v, newKey, old);
      if (next) { value[field] = next; touched = true; changed++; }
    }
    if (touched) await prisma.setting.update({ where: { key }, data: { value: value as Prisma.InputJsonObject } });
  }

  const users = await prisma.user.findMany({ where: { OR: [{ totpSecret: { not: null } }, { totpPendingSecret: { not: null } }] }, select: { id: true, totpSecret: true, totpPendingSecret: true } });
  for (const u of users) {
    const data: { totpSecret?: string; totpPendingSecret?: string } = {};
    if (u.totpSecret) { const n = reseal(u.totpSecret, newKey, old); if (n) data.totpSecret = n; }
    if (u.totpPendingSecret) { const n = reseal(u.totpPendingSecret, newKey, old); if (n) data.totpPendingSecret = n; }
    if (Object.keys(data).length) { await prisma.user.update({ where: { id: u.id }, data }); changed += Object.keys(data).length; }
  }
  console.log(`Re-encrypted ${changed} secret(s) with the new key. You can now remove SETTINGS_ENCRYPTION_KEY_PREVIOUS.`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
