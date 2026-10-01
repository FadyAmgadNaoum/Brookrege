import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import type { Request } from "express";
import type { User } from "@prisma/client";
import { lockUntilAfterFailure, minutesLeft, restrictionFor, sessionState, type SessionState } from "@brookrege/domain";
import { env } from "../../config/env";
import { audit } from "../../lib/audit";
import { AppError, unauthorized } from "../../lib/errors";
import { logger } from "../../lib/logger";
import { prisma } from "../../lib/prisma";
import { queueEmail } from "../notifications/notify.service";

const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const ISSUER = "brookrege-api";

// Compared against when the email doesn't exist, so response time doesn't reveal which emails are staff.
const DUMMY_HASH = bcrypt.hashSync("timing-equalizer-not-a-real-password", env.BCRYPT_ROUNDS);

export const hashPassword = (pw: string) => bcrypt.hash(pw, env.BCRYPT_ROUNDS);
/** "$2a$12$…" → 12 */
const roundsOf = (hash: string) => Number(hash.split("$")[2]) || 0;

const clientOf = (req: Request) => ({ ip: req.ip ?? null, userAgent: req.get("user-agent")?.slice(0, 300) ?? null });

export const publicUser = (u: Pick<User, "id" | "email" | "name" | "role">) => ({ id: u.id, email: u.email, name: u.name, role: u.role });

export const lockedError = (until: Date) =>
  new AppError(423, "ACCOUNT_LOCKED", `Too many failed attempts. This account is locked for ${minutesLeft(until)} more minute(s). A super admin can unlock it sooner.`);

/* ───────────────────────── Security alert emails ───────────────────────── */

/** Tells the person about security-relevant changes to their own account (sent in the background). */
export async function securityAlert(user: Pick<User, "email" | "name">, event: string, req: Request | null) {
  const when = new Date().toISOString().replace("T", " ").slice(0, 16) + " UTC";
  await queueEmail("security_alert", [user.email], { name: user.name, event, when, ip: req?.ip ?? "—" }, "en").catch((e) =>
    logger.error("security_alert_queue_failed", { message: (e as Error).message }),
  );
}

/* ───────────────────────── Failed attempts & lockout ───────────────────────── */

/** Counts a failed password. Returns the lock end time if this failure locked the account. */
async function recordFailure(req: Request, user: Pick<User, "id" | "email" | "name">, kind: "password" | "password_change"): Promise<Date | null> {
  const { failedLoginCount } = await prisma.user.update({ where: { id: user.id }, data: { failedLoginCount: { increment: 1 } }, select: { failedLoginCount: true } });
  const action = kind === "password_change" ? "auth.password_check_failed" : "auth.login_failed";
  await audit(req, { action, entityType: "User", entityId: user.id, after: { attempt: failedLoginCount } });
  const until = lockUntilAfterFailure(failedLoginCount);
  if (until) {
    await prisma.user.update({ where: { id: user.id }, data: { lockedUntil: until } });
    await audit(req, { action: "auth.locked", entityType: "User", entityId: user.id, after: { until, failedAttempts: failedLoginCount } });
    await securityAlert(user, `Your account was locked for ${minutesLeft(until)} minutes after ${failedLoginCount} failed sign-in attempts. If this wasn't you, tell a super admin.`, req);
  }
  return until;
}

/* ───────────────────────── Tokens & sessions ───────────────────────── */

function signAccess(user: Pick<User, "id" | "role" | "email">, sessionId: string) {
  return jwt.sign({ role: user.role, email: user.email, sid: sessionId }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    issuer: ISSUER,
    algorithm: "HS256",
    expiresIn: env.ACCESS_TOKEN_TTL_MIN * 60,
  });
}

async function issueRefresh(userId: string, sessionId: string, sessionExpiresAt: Date) {
  const token = randomBytes(48).toString("base64url");
  const max = Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 86_400_000;
  await prisma.refreshToken.create({
    data: { userId, familyId: sessionId, tokenHash: sha256(token), expiresAt: new Date(Math.min(max, sessionExpiresAt.getTime())) },
  });
  return token;
}

/** Ends sessions and their refresh tokens. Used for logout, idle timeout, password changes and admin action. */
export async function revokeSessions(where: { userId?: string; sessionIds?: string[]; exceptSessionId?: string }, reason: string) {
  const sessions = await prisma.adminSession.findMany({
    where: {
      revokedAt: null,
      ...(where.userId ? { userId: where.userId } : {}),
      ...(where.sessionIds ? { id: { in: where.sessionIds } } : {}),
      ...(where.exceptSessionId ? { id: { not: where.exceptSessionId } } : {}),
    },
    select: { id: true },
  });
  const ids = sessions.map((s) => s.id);
  if (!ids.length) return 0;
  const now = new Date();
  await prisma.$transaction([
    prisma.adminSession.updateMany({ where: { id: { in: ids }, revokedAt: null }, data: { revokedAt: now, revokedReason: reason } }),
    prisma.refreshToken.updateMany({ where: { familyId: { in: ids }, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  return ids.length;
}

/** Kept for existing callers (team management). */
export const revokeAllForUser = (userId: string, reason = "admin") => revokeSessions({ userId }, reason);

async function startSession(req: Request, user: User) {
  const now = new Date();
  const { ip, userAgent } = clientOf(req);
  const session = await prisma.adminSession.create({
    data: { userId: user.id, ip, userAgent, expiresAt: new Date(now.getTime() + env.SESSION_MAX_HOURS * 3_600_000) },
  });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: now, failedLoginCount: 0, lockedUntil: null } });
  return {
    user: publicUser(user),
    restriction: restrictionFor(user),
    access: signAccess(user, session.id),
    refresh: await issueRefresh(user.id, session.id, session.expiresAt),
    sessionId: session.id,
  };
}

export type SessionResult = Awaited<ReturnType<typeof startSession>>;

/* ───────────────────────── Sign-in ───────────────────────── */

export async function login(req: Request, email: string, password: string): Promise<SessionResult> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  // While locked, the password isn't even checked — guesses during the lock tell the attacker nothing.
  if (user?.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);

  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    if (user) {
      const until = await recordFailure(req, user, "password");
      if (until) throw lockedError(until);
    } else {
      await audit(req, { action: "auth.login_failed", entityType: "User", after: { email: email.toLowerCase().slice(0, 200) } });
    }
    throw unauthorized("Email or password is incorrect.");
  }
  if (user.status !== "ACTIVE") throw unauthorized("This account is suspended. Contact a super admin.");

  // Hashes made with a lower cost (older settings) are upgraded transparently.
  if (roundsOf(user.passwordHash) < env.BCRYPT_ROUNDS) {
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(password) } });
  }

  return startSession(req, user);
}

/* ───────────────────────── Refresh & logout ───────────────────────── */

const idleMessage = () => `You were signed out after ${env.SESSION_IDLE_MINUTES} minutes without activity. Sign in again.`;
export const endedMessage = (state: SessionState) => (state === "idle" ? idleMessage() : "Your session has ended. Sign in again.");

/**
 * Refresh-token rotation with reuse detection: every refresh replaces the token. If an already-used
 * token comes back, it was stolen and replayed — the whole session is ended for both parties.
 * The session's idle timeout and absolute limit are enforced here too.
 */
export async function refresh(presented: string | undefined) {
  if (!presented) throw unauthorized();
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) }, include: { user: true } });
  if (!row) throw unauthorized();

  if (row.revokedAt) {
    await revokeSessions({ sessionIds: [row.familyId] }, "replay");
    logger.warn("refresh_token_reuse_detected", { userId: row.userId, sessionId: row.familyId });
    throw unauthorized("Your session was ended for security. Sign in again.");
  }
  const session = await prisma.adminSession.findUnique({ where: { id: row.familyId } });
  if (!session) throw unauthorized(); // tokens from before Phase 3 have no session → sign in once
  const state = sessionState(session, env.SESSION_IDLE_MINUTES);
  if (state !== "active") {
    await revokeSessions({ sessionIds: [session.id] }, state);
    throw unauthorized(endedMessage(state));
  }
  if (row.expiresAt < new Date() || row.user.status !== "ACTIVE") throw unauthorized();

  const revoked = await prisma.refreshToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
  if (revoked.count === 0) throw unauthorized(); // a parallel refresh won

  await prisma.adminSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  return {
    user: publicUser(row.user),
    restriction: restrictionFor(row.user),
    access: signAccess(row.user, session.id),
    refresh: await issueRefresh(row.userId, session.id, session.expiresAt),
  };
}

export async function logout(presented: string | undefined, sessionId?: string) {
  const ids = new Set<string>();
  if (sessionId) ids.add(sessionId);
  if (presented) {
    const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(presented) }, select: { familyId: true } });
    if (row) ids.add(row.familyId);
  }
  if (ids.size) await revokeSessions({ sessionIds: [...ids] }, "logout");
}

/* ───────────────────────── Password change ───────────────────────── */

export async function verifyCurrentPassword(req: Request, user: User, password: string) {
  if (user.lockedUntil && user.lockedUntil > new Date()) throw lockedError(user.lockedUntil);
  if (await bcrypt.compare(password, user.passwordHash)) return;
  const until = await recordFailure(req, user, "password_change");
  if (until) throw lockedError(until);
  throw new AppError(400, "WRONG_PASSWORD", "Your current password isn't correct.", { currentPassword: ["Your current password isn't correct."] });
}

export const clientInfo = clientOf;
