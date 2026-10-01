import { Router, type Request, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import QRCode from "qrcode";
import { z } from "zod";
import { passwordProblems, permissionsFor, requires2fa } from "@brookrege/domain";
import { env } from "../../config/env";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { AppError, badRequest, conflict, notFound, unauthorized } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { canStoreSecrets, openSecret, sealSecret } from "../../lib/secrets";
import { getSecurityPolicy } from "../../lib/securitySettings";
import { formatSecret, generateTotpSecret, otpauthUrl, verifyTotp } from "../../lib/totp";
import { generateBackupCodes } from "../../lib/backupCodes";
import { authenticate, requireFullAccess } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { clearAuthCookies, MFA_COOKIE, REFRESH_COOKIE, setAuthCookies, setMfaCookie } from "./cookies";
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
    const result = await auth.login(req, email, password);
    if (result.kind === "mfa") {
      setMfaCookie(res, result.challenge);
      return res.json({ mfaRequired: true });
    }
    req.user = { id: result.session.user.id, role: result.session.user.role, email: result.session.user.email };
    await audit(req, { action: "auth.login", entityType: "User", entityId: result.session.user.id, after: { mfa: false } });
    sendSession(res, result.session);
  }),
);

const verifySchema = z
  .object({ code: z.string().trim().max(12).optional(), backupCode: z.string().trim().max(20).optional() })
  .refine((v) => Boolean(v.code) !== Boolean(v.backupCode), { message: "Enter the 6-digit code or a backup code." });

authRouter.post(
  "/2fa/verify",
  signInLimiter(),
  validate(verifySchema),
  asyncHandler(async (req, res) => {
    const session = await auth.verifyMfa(req, req.cookies?.[MFA_COOKIE], parsed<typeof verifySchema>(req, "body"));
    req.user = { id: session.user.id, role: session.user.role, email: session.user.email };
    await audit(req, { action: "auth.login", entityType: "User", entityId: session.user.id, after: { mfa: true } });
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
    const [policy, backupCodesLeft] = await Promise.all([getSecurityPolicy(), prisma.backupCode.count({ where: { userId: user.id, usedAt: null } })]);
    res.json({
      user: auth.publicUser(user),
      permissions: permissionsFor(user.role),
      restriction: req.auth!.restriction,
      security: {
        twoFactorEnabled: user.twoFactorEnabled,
        twoFactorRequired: requires2fa(user.role, policy.require2faForAll),
        backupCodesLeft,
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

/* ───────────────────────── Two-step verification ───────────────────────── */

async function qrSvg(url: string) {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#22302C", light: "#FFFFFF" } });
}

/** Step 1: create a secret and show it as a QR code. Nothing is active until step 2 confirms a code. */
authRouter.post(
  "/2fa/setup",
  authenticate,
  asyncHandler(async (req, res) => {
    if (!canStoreSecrets()) throw badRequest("Two-step verification isn't available yet: the server needs SETTINGS_ENCRYPTION_KEY. Ask your administrator.");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.twoFactorEnabled) throw conflict("Two-step verification is already on. Turn it off first to move it to a new phone.");
    const secret = generateTotpSecret();
    await prisma.user.update({ where: { id: user.id }, data: { totpPendingSecret: sealSecret(secret) } });
    const url = otpauthUrl({ secret, account: user.email, issuer: "Brookrege" });
    res.json({ data: { secret: formatSecret(secret), otpauthUrl: url, qrSvg: await qrSvg(url) } });
  }),
);

const codeSchema = z.object({ code: z.string().trim().min(6).max(12) });

async function newBackupCodes(userId: string) {
  const codes = generateBackupCodes();
  const hashes = await Promise.all(codes.map((c) => bcrypt.hash(c, 10)));
  await prisma.$transaction([
    prisma.backupCode.deleteMany({ where: { userId } }),
    prisma.backupCode.createMany({ data: hashes.map((codeHash) => ({ userId, codeHash })) }),
  ]);
  return codes;
}

/** Step 2: confirm the first code → 2FA on, backup codes shown once, other sessions signed out. */
authRouter.post(
  "/2fa/enable",
  authenticate,
  validate(codeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (user.twoFactorEnabled) throw conflict("Two-step verification is already on.");
    if (!user.totpPendingSecret) throw badRequest("Start the setup again — the QR code expired.");
    const secret = openSecret(user.totpPendingSecret);
    const r = verifyTotp(secret, parsed<typeof codeSchema>(req, "body").code);
    if (!r.ok) throw badRequest("That code didn't match. Scan the QR code again, then enter the newest 6-digit code.", { code: ["Code didn't match."] });
    await prisma.user.update({
      where: { id: user.id },
      data: { twoFactorEnabled: true, twoFactorEnabledAt: new Date(), totpSecret: user.totpPendingSecret, totpPendingSecret: null, totpLastStep: r.step },
    });
    const codes = await newBackupCodes(user.id);
    await prisma.adminSession.update({ where: { id: req.auth!.sessionId }, data: { mfaVerified: true } });
    const ended = await auth.revokeSessions({ userId: user.id, exceptSessionId: req.auth!.sessionId }, "2fa_changed");
    await audit(req, { action: "auth.2fa_enabled", entityType: "User", entityId: user.id, after: { otherSessionsEnded: ended } });
    await auth.securityAlert(user, "Two-step verification was turned on for your account.", req);
    res.json({ data: { backupCodes: codes } });
  }),
);

const disableSchema = z.object({ password: z.string().min(1).max(200), code: z.string().trim().min(6).max(12) });

authRouter.post(
  "/2fa/disable",
  authenticate,
  requireFullAccess,
  validate(disableSchema),
  asyncHandler(async (req, res) => {
    const { password, code } = parsed<typeof disableSchema>(req, "body");
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.twoFactorEnabled || !user.totpSecret) throw badRequest("Two-step verification is already off.");
    const policy = await getSecurityPolicy();
    if (requires2fa(user.role, policy.require2faForAll)) {
      throw new AppError(400, "MFA_REQUIRED", "Your role requires two-step verification, so it can't be turned off. Got a new phone? Ask a super admin to reset it, then set it up again.");
    }
    await auth.verifyCurrentPassword(req, user, password);
    if (!verifyTotp(openSecret(user.totpSecret), code, { lastUsedStep: user.totpLastStep }).ok) throw badRequest("That code didn't work.", { code: ["That code didn't work."] });
    await prisma.$transaction([
      prisma.user.update({ where: { id: user.id }, data: { twoFactorEnabled: false, twoFactorEnabledAt: null, totpSecret: null, totpPendingSecret: null, totpLastStep: null } }),
      prisma.backupCode.deleteMany({ where: { userId: user.id } }),
    ]);
    await audit(req, { action: "auth.2fa_disabled", entityType: "User", entityId: user.id });
    await auth.securityAlert(user, "Two-step verification was turned OFF for your account. If you didn't do this, contact a super admin immediately.", req);
    res.json({ data: { twoFactorEnabled: false } });
  }),
);

authRouter.post(
  "/2fa/backup-codes",
  authenticate,
  requireFullAccess,
  validate(codeSchema),
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.twoFactorEnabled || !user.totpSecret) throw badRequest("Turn on two-step verification first.");
    const r = verifyTotp(openSecret(user.totpSecret), parsed<typeof codeSchema>(req, "body").code, { lastUsedStep: user.totpLastStep });
    if (!r.ok) throw badRequest("That code didn't work.", { code: ["That code didn't work."] });
    await prisma.user.update({ where: { id: user.id }, data: { totpLastStep: r.step } });
    const codes = await newBackupCodes(user.id);
    await audit(req, { action: "auth.backup_codes_regenerated", entityType: "User", entityId: user.id });
    await auth.securityAlert(user, "New backup codes were created. Your old backup codes no longer work.", req);
    res.json({ data: { backupCodes: codes } });
  }),
);

/* ───────────────────────── My sessions ───────────────────────── */

const sessionSelect = { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaVerified: true } as const;

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
