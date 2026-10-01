import type { NextFunction, Request, RequestHandler, Response } from "express";
import jwt from "jsonwebtoken";
import { can, restrictionFor, sessionState, type Permission, type Role } from "@brookrege/domain";
import { env } from "../config/env";
import { AppError, forbidden, unauthorized } from "../lib/errors";
import { logger } from "../lib/logger";
import { prisma } from "../lib/prisma";
import { ACCESS_COOKIE } from "../modules/auth/cookies";
import { endedMessage, revokeSessions } from "../modules/auth/auth.service";

interface AccessClaims { sub: string; role: Role; email: string; sid?: string }

/** Refresh lastSeenAt at most once a minute per session (keeps the idle timer accurate without a write per request). */
const TOUCH_EVERY_MS = 60_000;

/**
 * Verifies the access token AND the server-side session behind it, on every admin request:
 *  - revoked sessions stop working immediately (not after the 15-minute token lifetime);
 *  - sessions idle for SESSION_IDLE_MINUTES (default 60) are ended;
 *  - the role comes from the database, so a role change applies at once.
 */
export const authenticate: RequestHandler = (req, res, next) => {
  authenticateAsync(req, res).then(() => next(), next);
};

async function authenticateAsync(req: Request, _res: Response) {
  const token = req.cookies?.[ACCESS_COOKIE] as string | undefined;
  if (!token) throw unauthorized();
  let claims: AccessClaims;
  try {
    claims = jwt.verify(token, env.JWT_ACCESS_SECRET, { algorithms: ["HS256"], issuer: "brookrege-api" }) as AccessClaims;
  } catch {
    throw unauthorized("Your session expired. Sign in again.");
  }
  // Only session access tokens: any other token signed with the same secret (it would carry an audience) is rejected.
  if (!claims.sid || (claims as { aud?: unknown }).aud !== undefined) throw unauthorized();

  const s = await prisma.adminSession.findUnique({
    where: { id: claims.sid },
    include: { user: { select: { id: true, email: true, role: true, status: true, mustChangePassword: true } } },
  });
  if (!s || s.userId !== claims.sub) throw unauthorized();

  const state = sessionState(s, env.SESSION_IDLE_MINUTES);
  if (state !== "active") {
    if (!s.revokedAt) await revokeSessions({ sessionIds: [s.id] }, state);
    throw unauthorized(endedMessage(state));
  }
  if (s.user.status !== "ACTIVE") throw unauthorized("This account is suspended. Contact a super admin.");

  req.user = { id: s.user.id, role: s.user.role, email: s.user.email };
  req.auth = { sessionId: s.id, restriction: restrictionFor(s.user) };

  if (Date.now() - s.lastSeenAt.getTime() > TOUCH_EVERY_MS) {
    prisma.adminSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch((e) => logger.warn("session_touch_failed", { message: e.message }));
  }
}

/**
 * Until a person replaces a temporary password they can only reach the
 * password endpoints. Everything else answers 403 with a code the admin app understands.
 */
export const requireFullAccess: RequestHandler = (req, _res, next: NextFunction) => {
  if ((req.auth?.restriction ?? "NONE") === "NONE") return next();
  next(new AppError(403, "PASSWORD_CHANGE_REQUIRED", "Choose a new password to continue."));
};

export const requirePermission =
  (permission: Permission): RequestHandler =>
  (req, _res, next) => {
    if (!req.user) return next(unauthorized());
    if (!can(req.user.role, permission)) return next(forbidden());
    next();
  };
