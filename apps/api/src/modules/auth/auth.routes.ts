import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { passwordProblems, permissionsFor } from "@brookrege/domain";
import { env } from "../../config/env";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, notFound, unauthorized } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { authenticate, requireFullAccess } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { clearAuthCookies, REFRESH_COOKIE, setAuthCookies } from "./cookies";
import * as auth from "./auth.service";

export const authRouter = Router();

// Per-IP limit on this server. The account lockout (database) and Nginx/Cloudflare limits apply on top.
const signInLimiter = () =>
  rateLimit({
    windowMs: 15 * 60_000,
    limit: env.SIGNIN_RATE_LIMIT,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    message: { error: { code: "RATE_LIMITED", message: "Too many sign-in attempts from this network. Wait 15 minutes and try again." } },
  });

function sendSession(res: Response, s: auth.SessionResult) {
  setAuthCookies(res, s.access, s.refresh);
  res.json({ user: s.user, permissions: permissionsFor(s.user.role), restriction: s.restriction });
}

/* ───────────────────────── Sign in ───────────────────────── */

const loginSchema = z.object({ email: z.string().trim().email().max(200), password: z.string().min(1).max(200) });

authRouter.post(
  "/login",
  signInLimiter(),
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = parsed<typeof loginSchema>(req, "body");
    const session = await auth.login(req, email, password);
    req.user = { id: session.user.id, role: session.user.role, email: session.user.email };
    await audit(req, { action: "auth.login", entityType: "User", entityId: session.user.id });
    sendSession(res, session);
  }),
);

authRouter.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    try {
      const r = await auth.refresh(req.cookies?.[REFRESH_COOKIE]);
      setAuthCookies(res, r.access, r.refresh);
      res.json({ user: r.user, permissions: permissionsFor(r.user.role), restriction: r.restriction });
    } catch (e) {
      clearAuthCookies(res);
      throw e;
    }
  }),
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    await auth.logout(req.cookies?.[REFRESH_COOKIE]);
    clearAuthCookies(res);
    res.status(204).end();
  }),
);

/* ───────────────────────── Who am I ───────────────────────── */

authRouter.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({ where: { id: req.user!.id } });
    if (!user) throw unauthorized();
    res.json({
      user: auth.publicUser(user),
      permissions: permissionsFor(user.role),
      restriction: req.auth!.restriction,
      security: {
        passwordChangedAt: user.passwordChangedAt,
        sessionIdleMinutes: env.SESSION_IDLE_MINUTES,
      },
    });
  }),
);

/* ───────────────────────── Password ───────────────────────── */

const passwordSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200) });

authRouter.post(
  "/password",
  authenticate,
  validate(passwordSchema),
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = parsed<typeof passwordSchema>(req, "body");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    await auth.verifyCurrentPassword(req, user, currentPassword);
    const problems = passwordProblems(newPassword, user);
    if (problems.length) throw badRequest(problems[0]!, { newPassword: problems });
    if (await bcrypt.compare(newPassword, user.passwordHash)) throw badRequest("Choose a password different from your current one.", { newPassword: ["Choose a different password."] });
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: await auth.hashPassword(newPassword), passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0 },
    });
    // Everyone else using this account is signed out; this browser stays signed in.
    const ended = await auth.revokeSessions({ userId: user.id, exceptSessionId: req.auth!.sessionId }, "password_changed");
    await audit(req, { action: "auth.password_changed", entityType: "User", entityId: user.id, after: { otherSessionsEnded: ended } });
    await auth.securityAlert(user, "Your password was changed. If you didn't do this, contact a super admin immediately.", req);
    res.json({ data: { otherSessionsEnded: ended } });
  }),
);

/* ───────────────────────── My sessions ───────────────────────── */

const sessionSelect = { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true } as const;

async function activeSessionsOf(userId: string) {
  const idleCutoff = new Date(Date.now() - env.SESSION_IDLE_MINUTES * 60_000);
  return prisma.adminSession.findMany({
    where: { userId, revokedAt: null, expiresAt: { gt: new Date() }, lastSeenAt: { gt: idleCutoff } },
    orderBy: { lastSeenAt: "desc" },
    select: sessionSelect,
  });
}

authRouter.get(
  "/sessions",
  authenticate,
  requireFullAccess,
  asyncHandler(async (req, res) => {
    const rows = await activeSessionsOf(req.user!.id);
    res.json({ data: rows.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) });
  }),
);

const sessionParam = z.object({ id: z.string().min(1).max(40) });

authRouter.delete(
  "/sessions/:id",
  authenticate,
  requireFullAccess,
  validate(sessionParam, "params"),
  asyncHandler(async (req: Request, res) => {
    const { id } = parsed<typeof sessionParam>(req, "params");
    const s = await prisma.adminSession.findFirst({ where: { id, userId: req.user!.id } });
    if (!s) throw notFound("Session");
    await auth.revokeSessions({ sessionIds: [id] }, "logout");
    await audit(req, { action: "auth.session_revoked", entityType: "AdminSession", entityId: id, after: { self: true } });
    res.status(204).end();
  }),
);

authRouter.post(
  "/sessions/revoke-others",
  authenticate,
  requireFullAccess,
  asyncHandler(async (req, res) => {
    const ended = await auth.revokeSessions({ userId: req.user!.id, exceptSessionId: req.auth!.sessionId }, "logout");
    await audit(req, { action: "auth.session_revoked", entityType: "User", entityId: req.user!.id, after: { others: ended } });
    res.json({ data: { ended } });
  }),
);
