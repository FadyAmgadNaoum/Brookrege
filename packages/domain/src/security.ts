import type { Role } from "./permissions";

/* ───────────────────────── Password policy ─────────────────────────
 * Length first (NIST 800-63B), plus a blocklist of predictable passwords and a ban on
 * the person's own name/email. The four character classes are kept because the client
 * asked for a "strong password policy" and staff already use it.
 */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

/** Checked as case-insensitive substrings after removing digits/symbols (so "Brookrege2026!" matches "brookrege"). */
const PREDICTABLE = [
  "password", "passw0rd", "qwerty", "azerty", "asdfgh", "zxcvbn", "letmein", "welcome", "admin", "administrator",
  "iloveyou", "monkey", "dragon", "football", "baseball", "master", "shadow", "sunshine", "princess", "superman",
  "brookrege", "brook", "sohag", "egypt", "cairo", "misr", "realestate", "property", "changeme", "default", "secret",
];
const SEQUENCES = ["0123456789", "9876543210", "abcdefghijklmnopqrstuvwxyz", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

export interface PasswordContext { email?: string | null; name?: string | null }

/** Returns the problems, each a short instruction; an empty array means the password is acceptable. */
export function passwordProblems(pw: string, ctx: PasswordContext = {}): string[] {
  const out: string[] = [];
  if (pw.length < PASSWORD_MIN) out.push(`Use at least ${PASSWORD_MIN} characters.`);
  if (pw.length > PASSWORD_MAX) out.push(`Use at most ${PASSWORD_MAX} characters.`);
  if (!/[a-z]/.test(pw)) out.push("Add a lowercase letter.");
  if (!/[A-Z]/.test(pw)) out.push("Add an uppercase letter.");
  if (!/\d/.test(pw)) out.push("Add a number.");
  if (!/[^A-Za-z0-9]/.test(pw)) out.push("Add a symbol.");
  const lower = pw.toLowerCase();
  const letters = lower.replace(/[^a-z]/g, "");
  if (/(.)\1{3,}/.test(lower)) out.push("Avoid repeating the same character 4 or more times.");
  const hasSequence = SEQUENCES.some((seq) => {
    for (let i = 0; i + 5 <= seq.length; i++) if (lower.includes(seq.slice(i, i + 5))) return true;
    return false;
  });
  if (hasSequence) out.push("Avoid keyboard or number sequences like 12345 or qwert.");
  if (PREDICTABLE.some((w) => letters.includes(w))) out.push("Avoid common words like “password”, “admin” or the company name.");
  const personal = [
    ...(ctx.email ? ctx.email.toLowerCase().split("@")[0]!.split(/[._+-]/) : []),
    ...(ctx.name ? ctx.name.toLowerCase().split(/\s+/) : []),
  ].filter((p) => p.length >= 3);
  if (personal.some((p) => lower.includes(p))) out.push("Don't include your name or email address.");
  return [...new Set(out)];
}

/** 0 (very weak) … 4 (strong) — for the strength meter only; acceptance is decided by passwordProblems. */
export function passwordStrength(pw: string, ctx: PasswordContext = {}): 0 | 1 | 2 | 3 | 4 {
  if (!pw) return 0;
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = (pw.length >= 16 ? 2 : pw.length >= PASSWORD_MIN ? 1 : 0) + (classes >= 3 ? 1 : 0) + (classes === 4 && pw.length >= 14 ? 1 : 0);
  if (passwordProblems(pw, ctx).length) score = Math.min(score, 1);
  return Math.max(0, Math.min(4, score)) as 0 | 1 | 2 | 3 | 4;
}

/* ───────────────────────── Account lockout ─────────────────────────
 * Every 5th consecutive failed password or 2FA code locks the account:
 * 15 min, then 30, 60 … capped at 24 h. Stored in the database, so it holds across app servers.
 */
export const LOCKOUT_THRESHOLD = 5;
export const LOCKOUT_BASE_MINUTES = 15;
export const LOCKOUT_MAX_MINUTES = 24 * 60;

/** `failedCount` is the count AFTER this failure. Returns when the lock ends, or null if no lock yet. */
export function lockUntilAfterFailure(failedCount: number, now = new Date()): Date | null {
  if (failedCount < LOCKOUT_THRESHOLD || failedCount % LOCKOUT_THRESHOLD !== 0) return null;
  const round = failedCount / LOCKOUT_THRESHOLD; // 1, 2, 3 …
  const minutes = Math.min(LOCKOUT_MAX_MINUTES, LOCKOUT_BASE_MINUTES * 2 ** (round - 1));
  return new Date(now.getTime() + minutes * 60_000);
}

export const minutesLeft = (until: Date, now = new Date()) => Math.max(1, Math.ceil((until.getTime() - now.getTime()) / 60_000));

/* ───────────────────────── Sessions ───────────────────────── */
export interface SessionTimes { createdAt: Date; lastSeenAt: Date; expiresAt: Date; revokedAt: Date | null }
export type SessionState = "active" | "idle" | "expired" | "revoked";

/** Idle = no activity for `idleMinutes` (default policy: 60). Expired = past the absolute limit. */
export function sessionState(s: SessionTimes, idleMinutes: number, now = new Date()): SessionState {
  if (s.revokedAt) return "revoked";
  if (s.expiresAt.getTime() <= now.getTime()) return "expired";
  if (now.getTime() - s.lastSeenAt.getTime() >= idleMinutes * 60_000) return "idle";
  return "active";
}

/* ───────────────────────── Two-step verification ───────────────────────── */
/**
 * Two-step verification is optional for every role (the owner's choice, DECISIONS row 78). Anyone can turn it on
 * in My account; a super admin can make it compulsory for all staff with the "Require for everyone" policy.
 */
export const requires2fa = (_role: Role, requireForAll: boolean) => requireForAll;

/** What a signed-in person may do before they finish mandatory steps. */
export type Restriction = "NONE" | "PASSWORD_CHANGE" | "MFA_SETUP";

export function restrictionFor(u: { role: Role; twoFactorEnabled: boolean; mustChangePassword: boolean }, requireForAll: boolean): Restriction {
  if (u.mustChangePassword) return "PASSWORD_CHANGE";
  if (requires2fa(u.role, requireForAll) && !u.twoFactorEnabled) return "MFA_SETUP";
  return "NONE";
}
