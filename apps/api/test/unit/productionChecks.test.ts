import { test } from "node:test";
import assert from "node:assert/strict";
import { productionProblems, type ProdEnv } from "../../src/lib/productionChecks";

const good: ProdEnv = {
  JWT_ACCESS_SECRET: "9f2c".repeat(24), SETTINGS_ENCRYPTION_KEY: "4b7e".repeat(16), cookieSecure: true,
  PUBLIC_API_URL: "https://brookrege.com", ADMIN_APP_URL: "https://admin.brookrege.com",
  corsOrigins: ["https://brookrege.com", "https://admin.brookrege.com"], ADMIN_IP_ALLOWLIST_BYPASS: false,
};

test("a correctly configured production server starts", () => assert.deepEqual(productionProblems(good), { errors: [], warnings: [] }));

test("development values are refused", () => {
  const r = productionProblems({ ...good,
    JWT_ACCESS_SECRET: "local-development-secret-not-for-production-use-0123456789",
    SETTINGS_ENCRYPTION_KEY: "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f",
    cookieSecure: false, PUBLIC_API_URL: "http://localhost:4000", corsOrigins: ["http://localhost:3000"] });
  const text = r.errors.join(" | ");
  for (const m of ["example/development value", "SETTINGS_ENCRYPTION_KEY is an example", "Secure", "PUBLIC_API_URL must use https", "CORS_ORIGINS"]) assert.ok(text.includes(m), m);
});

test("short secret and missing encryption key", () => {
  const r = productionProblems({ ...good, JWT_ACCESS_SECRET: "x".repeat(40), SETTINGS_ENCRYPTION_KEY: undefined });
  assert.equal(r.errors.length, 2);
});

test("rotation mistake and emergency bypass", () => {
  assert.ok(productionProblems({ ...good, SETTINGS_ENCRYPTION_KEY_PREVIOUS: good.SETTINGS_ENCRYPTION_KEY }).errors[0]!.includes("PREVIOUS"));
  assert.equal(productionProblems({ ...good, ADMIN_IP_ALLOWLIST_BYPASS: true }).warnings.length, 1);
});

test("Redis must be password-protected in production", () => {
  const base = { JWT_ACCESS_SECRET: "x".repeat(64), SETTINGS_ENCRYPTION_KEY: "ab".repeat(32), cookieSecure: true, PUBLIC_API_URL: "https://brookrege.com", ADMIN_APP_URL: "https://admin.brookrege.com", corsOrigins: ["https://brookrege.com"], ADMIN_IP_ALLOWLIST_BYPASS: false };
  assert.match(productionProblems({ ...base, REDIS_URL: "redis://10.0.0.3:6379/0" }).errors.join(" "), /must include a password/);
  assert.match(productionProblems({ ...base, REDIS_URL: "redis://:short@10.0.0.3:6379/0" }).errors.join(" "), /too short/);
  assert.deepEqual(productionProblems({ ...base, REDIS_URL: `redis://:${"k".repeat(32)}@10.0.0.3:6379/0` }).errors, []);
  assert.deepEqual(productionProblems(base).errors, []);
});
