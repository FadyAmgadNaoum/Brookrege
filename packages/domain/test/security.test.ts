import { test } from "node:test";
import assert from "node:assert/strict";
import { passwordProblems, passwordStrength, lockUntilAfterFailure, sessionState, requires2fa, restrictionFor, minutesLeft } from "../src/security";
import { can } from "../src/permissions";

test("password policy accepts a strong passphrase", () => {
  assert.deepEqual(passwordProblems("Nile-Garden-Balcony-7"), []);
  assert.deepEqual(passwordProblems("Tr0mbone!Cactus-Lamp", { email: "mona.adel@brookrege.com", name: "Mona Adel" }), []);
});

test("password policy rejects weak or predictable passwords", () => {
  assert.ok(passwordProblems("Short1!").some((p) => p.includes("12 characters")));
  assert.ok(passwordProblems("Brookrege2026!!").some((p) => p.includes("common words")), "company name");
  assert.ok(passwordProblems("Password-2026!x").some((p) => p.includes("common words")));
  assert.ok(passwordProblems("Abc!12345xyzQ").some((p) => p.includes("sequences")), "12345");
  assert.ok(passwordProblems("Qwerty!Garden9").some((p) => p.includes("sequences") || p.includes("common")));
  assert.ok(passwordProblems("Aaaaa!Garden9x").some((p) => p.includes("repeating")));
  assert.ok(passwordProblems("Garden!Mona2026", { name: "Mona Adel" }).some((p) => p.includes("name or email")));
  assert.ok(passwordProblems("Garden!Fady2026x", { email: "fady@unilira.com" }).some((p) => p.includes("name or email")));
  assert.ok(passwordProblems("all-lowercase-long-1").some((p) => p.includes("uppercase")));
  assert.ok(passwordProblems("x".repeat(129) + "A1!").some((p) => p.includes("at most")));
});

test("strength meter", () => {
  assert.equal(passwordStrength(""), 0);
  assert.ok(passwordStrength("Password-2026!x") <= 1, "blocked words cap the score");
  assert.equal(passwordStrength("Nile-Garden-Balcony-7"), 4);
});

test("lockout: every 5th failure, doubling, capped at 24h", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const mins = (d: Date | null) => (d ? (d.getTime() - now.getTime()) / 60_000 : null);
  assert.equal(mins(lockUntilAfterFailure(4, now)), null);
  assert.equal(mins(lockUntilAfterFailure(5, now)), 15);
  assert.equal(mins(lockUntilAfterFailure(6, now)), null);
  assert.equal(mins(lockUntilAfterFailure(10, now)), 30);
  assert.equal(mins(lockUntilAfterFailure(15, now)), 60);
  assert.equal(mins(lockUntilAfterFailure(100, now)), 24 * 60);
  assert.equal(minutesLeft(new Date(now.getTime() + 61_000), now), 2);
});

test("session state: 1-hour idle timeout and absolute expiry", () => {
  const now = new Date("2026-09-26T10:00:00Z");
  const base = { createdAt: new Date("2026-09-26T08:00:00Z"), expiresAt: new Date("2026-09-26T20:00:00Z"), revokedAt: null };
  assert.equal(sessionState({ ...base, lastSeenAt: new Date("2026-09-26T09:30:00Z") }, 60, now), "active");
  assert.equal(sessionState({ ...base, lastSeenAt: new Date("2026-09-26T09:00:00Z") }, 60, now), "idle");
  assert.equal(sessionState({ ...base, lastSeenAt: now, expiresAt: now }, 60, now), "expired");
  assert.equal(sessionState({ ...base, lastSeenAt: now, revokedAt: now }, 60, now), "revoked");
});

test("2FA requirement and restrictions", () => {
  assert.equal(requires2fa("SUPER_ADMIN", false), false, "optional unless the policy says otherwise");
  assert.equal(requires2fa("CONTENT_ADMIN", false), false);
  assert.equal(requires2fa("MODERATOR", true), true);
  assert.equal(requires2fa("SUPER_ADMIN", true), true);
  assert.equal(restrictionFor({ role: "SUPER_ADMIN", twoFactorEnabled: false, mustChangePassword: false }, false), "NONE");
  assert.equal(restrictionFor({ role: "SUPER_ADMIN", twoFactorEnabled: false, mustChangePassword: false }, true), "MFA_SETUP");
  assert.equal(restrictionFor({ role: "SUPER_ADMIN", twoFactorEnabled: true, mustChangePassword: false }, false), "NONE");
  assert.equal(restrictionFor({ role: "CONTENT_ADMIN", twoFactorEnabled: false, mustChangePassword: true }, true), "PASSWORD_CHANGE", "password first");
  assert.equal(restrictionFor({ role: "CONTENT_ADMIN", twoFactorEnabled: false, mustChangePassword: false }, false), "NONE");
});

test("security permissions are super-admin only", () => {
  assert.equal(can("SUPER_ADMIN", "security:manage"), true);
  assert.equal(can("CONTENT_ADMIN", "security:manage"), false);
  assert.equal(can("CONTENT_ADMIN", "privacy:manage"), false);
  assert.equal(can("SUPER_ADMIN", "privacy:manage"), true);
});
