import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRIVACY_POLICY, maskEmail, maskPhone, monthsBefore, normalizeEmail, phoneVariants, retentionCutoffs } from "../src/privacy";
import { can } from "../src/permissions";

test("monthsBefore uses calendar months and clamps the day", () => {
  assert.equal(monthsBefore(new Date("2026-09-26T10:00:00Z"), 24).toISOString(), "2024-09-26T10:00:00.000Z");
  assert.equal(monthsBefore(new Date("2026-03-31T00:00:00Z"), 1).toISOString(), "2026-02-28T00:00:00.000Z");
  assert.equal(monthsBefore(new Date("2024-03-31T00:00:00Z"), 1).toISOString(), "2024-02-29T00:00:00.000Z");
  assert.equal(monthsBefore(new Date("2026-01-15T00:00:00Z"), 13).toISOString(), "2024-12-15T00:00:00.000Z");
});

test("retentionCutoffs follow the policy", () => {
  const c = retentionCutoffs(DEFAULT_PRIVACY_POLICY, new Date("2026-09-26T00:00:00Z"));
  assert.equal(c.leads.toISOString().slice(0, 10), "2024-09-26");
  assert.equal(c.logs.toISOString().slice(0, 10), "2025-09-26");
});

test("phoneVariants finds every stored form of an Egyptian mobile", () => {
  const all = ["01012345678", "+201012345678", "201012345678", "00201012345678"];
  for (const input of [...all, "010 1234 5678", "+20 (101) 234-5678"]) assert.deepEqual(phoneVariants(input).sort(), [...all].sort(), input);
  assert.deepEqual(phoneVariants("+44 7700 900123").sort(), ["+447700900123", "00447700900123", "447700900123"].sort());
  assert.deepEqual(phoneVariants("hello"), []);
  assert.deepEqual(phoneVariants("12"), []);
  assert.deepEqual(phoneVariants("' OR 1=1"), []);
});

test("masking keeps just enough to recognise", () => {
  assert.equal(maskPhone("01012345678"), "010•••••678");
  assert.equal(maskPhone("123"), "•••");
  assert.equal(maskEmail("ahmed@example.com"), "a•••@example.com");
  assert.equal(normalizeEmail("  Ahmed@Example.COM "), "ahmed@example.com");
});

test("only super admins handle personal-data requests", () => {
  assert.equal(can("SUPER_ADMIN", "privacy:manage"), true);
  for (const r of ["CONTENT_ADMIN", "MODERATOR"] as const) assert.equal(can(r, "privacy:manage"), false);
});
