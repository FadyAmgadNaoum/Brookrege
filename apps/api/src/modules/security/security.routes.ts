import { Router } from "express";
import { z } from "zod";
import { requires2fa } from "@brookrege/domain";
import { env } from "../../config/env";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { buildBlockList, ipAllowed, normalizeIp, parseEntry } from "../../lib/ipAllowlist";
import { prisma } from "../../lib/prisma";
import { canStoreSecrets } from "../../lib/secrets";
import { getIpAllowlist, getSecurityPolicy, saveIpAllowlist, saveSecurityPolicy } from "../../lib/securitySettings";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { revokeSessions } from "../auth/auth.service";

/** Admin › Security (super admins). */
export const adminSecurityRouter = Router();
adminSecurityRouter.use(requirePermission("security:manage"));

const SECURITY_ACTIONS = ["auth.", "security.", "team.", "privacy."];
const DAY = 86_400_000;

/** Configuration checks shown on the Security page: each says what's wrong and how to fix it. */
function configChecks() {
  const https = (u: string) => u.startsWith("https://");
  return [
    { id: "env", label: "Running with production safety checks", ok: env.appEnv === "production", detail: `APP_ENV=${env.appEnv}. Production refuses to start with example secrets or insecure settings.` },
    { id: "encryption", label: "Secrets are encrypted at rest", ok: canStoreSecrets(), detail: canStoreSecrets() ? "2FA secrets and provider API keys are AES-256-GCM encrypted." : "Set SETTINGS_ENCRYPTION_KEY — 2FA can't be enabled without it." },
    { id: "cookies", label: "Sign-in cookies are HTTPS-only", ok: env.cookieSecure, detail: env.cookieSecure ? "Secure, HttpOnly, SameSite=Strict, host-locked (__Host-)." : "COOKIE_SECURE is off (fine only on http://localhost)." },
    { id: "https", label: "Site and admin use HTTPS", ok: https(env.PUBLIC_API_URL) && https(env.ADMIN_APP_URL), detail: `${env.PUBLIC_API_URL} · ${env.ADMIN_APP_URL}` },
    { id: "idle", label: `Sessions end after ${env.SESSION_IDLE_MINUTES} minutes of inactivity`, ok: env.SESSION_IDLE_MINUTES <= 60, detail: `Absolute limit ${env.SESSION_MAX_HOURS} hours.` },
    { id: "bcrypt", label: `Passwords hashed with bcrypt (cost ${env.BCRYPT_ROUNDS})`, ok: env.BCRYPT_ROUNDS >= 10, detail: "Older hashes are upgraded automatically at next sign-in." },
    { id: "bypass", label: "IP allowlist emergency bypass is off", ok: !env.ADMIN_IP_ALLOWLIST_BYPASS, detail: env.ADMIN_IP_ALLOWLIST_BYPASS ? "ADMIN_IP_ALLOWLIST_BYPASS=true — turn it off after the emergency." : "Normal." },
  ];
}

adminSecurityRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const now = new Date();
    const idleCutoff = new Date(now.getTime() - env.SESSION_IDLE_MINUTES * 60_000);
    const [policy, allowlist, staff, failed24h, failed7d, activeSessions, events] = await Promise.all([
      getSecurityPolicy(),
      getIpAllowlist(),
      prisma.user.findMany({
        orderBy: { createdAt: "asc" },
        select: {
          id: true, name: true, email: true, role: true, status: true, twoFactorEnabled: true, lockedUntil: true, lastLoginAt: true,
          mustChangePassword: true, passwordChangedAt: true,
          _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: idleCutoff } } }, backupCodes: { where: { usedAt: null } } } },
        },
      }),
      prisma.auditLog.count({ where: { action: { in: ["auth.login_failed", "auth.mfa_failed"] }, createdAt: { gt: new Date(now.getTime() - DAY) } } }),
      prisma.auditLog.count({ where: { action: { in: ["auth.login_failed", "auth.mfa_failed"] }, createdAt: { gt: new Date(now.getTime() - 7 * DAY) } } }),
      prisma.adminSession.count({ where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: idleCutoff } } }),
      prisma.auditLog.findMany({
        where: { OR: SECURITY_ACTIONS.map((p) => ({ action: { startsWith: p } })) },
        orderBy: { createdAt: "desc" },
        take: 50,
        select: { id: true, action: true, entityId: true, ip: true, after: true, createdAt: true, actor: { select: { name: true } } },
      }),
    ]);
    const active = staff.filter((u) => u.status === "ACTIVE");
    res.json({
      data: {
        counts: {
          staff: active.length,
          with2fa: active.filter((u) => u.twoFactorEnabled).length,
          required2faMissing: active.filter((u) => requires2fa(u.role, policy.require2faForAll) && !u.twoFactorEnabled).length,
          locked: staff.filter((u) => u.lockedUntil && u.lockedUntil > now).length,
          activeSessions,
          failedSignIns24h: failed24h,
          failedSignIns7d: failed7d,
        },
        policy: { ...policy, sessionIdleMinutes: env.SESSION_IDLE_MINUTES, sessionMaxHours: env.SESSION_MAX_HOURS },
        ipAllowlist: { enabled: allowlist.enabled, count: allowlist.entries.length },
        staff: staff.map(({ _count, ...u }) => ({ ...u, activeSessions: _count.sessions, backupCodesLeft: _count.backupCodes, twoFactorRequired: requires2fa(u.role, policy.require2faForAll) })),
        checks: configChecks(),
        events,
      },
    });
  }),
);

const policySchema = z.object({ require2faForAll: z.boolean() });
adminSecurityRouter.put(
  "/policy",
  validate(policySchema),
  asyncHandler(async (req, res) => {
    const before = await getSecurityPolicy();
    const after = parsed<typeof policySchema>(req, "body");
    await saveSecurityPolicy(after);
    await audit(req, { action: "security.policy_update", entityType: "Setting", entityId: "security.policy", before, after });
    res.json({ data: after });
  }),
);

/* ── Sessions of everyone ── */
adminSecurityRouter.get(
  "/sessions",
  asyncHandler(async (req, res) => {
    const now = new Date();
    const rows = await prisma.adminSession.findMany({
      where: { revokedAt: null, expiresAt: { gt: now }, lastSeenAt: { gt: new Date(now.getTime() - env.SESSION_IDLE_MINUTES * 60_000) } },
      orderBy: { lastSeenAt: "desc" },
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true, mfaVerified: true, user: { select: { id: true, name: true, role: true } } },
    });
    res.json({ data: rows.map((s) => ({ ...s, current: s.id === req.auth!.sessionId })) });
  }),
);

const idParam = z.object({ id: z.string().min(1).max(40) });
adminSecurityRouter.delete(
  "/sessions/:id",
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const { id } = parsed<typeof idParam>(req, "params");
    const s = await prisma.adminSession.findUnique({ where: { id }, select: { userId: true } });
    if (!s) throw notFound("Session");
    await revokeSessions({ sessionIds: [id] }, "admin");
    await audit(req, { action: "security.session_revoked", entityType: "AdminSession", entityId: id, after: { userId: s.userId } });
    res.status(204).end();
  }),
);

/* ── IP allowlist ── */
adminSecurityRouter.get(
  "/ip-allowlist",
  asyncHandler(async (req, res) => {
    res.json({ data: { ...(await getIpAllowlist()), yourIp: normalizeIp(req.ip ?? ""), bypassActive: env.ADMIN_IP_ALLOWLIST_BYPASS } });
  }),
);

const allowlistSchema = z.object({
  enabled: z.boolean(),
  entries: z.array(z.object({ value: z.string().trim().min(2).max(64), label: z.string().trim().max(80).nullable().optional() })).max(100),
});
adminSecurityRouter.put(
  "/ip-allowlist",
  validate(allowlistSchema),
  asyncHandler(async (req, res) => {
    const body = parsed<typeof allowlistSchema>(req, "body");
    const errors = body.entries.map((e) => parseEntry(e.value)).flatMap((p) => (p.ok ? [] : [p.error]));
    if (errors.length) throw badRequest(errors[0]!, { entries: errors });
    if (body.enabled) {
      if (!body.entries.length) throw badRequest("Add at least one address before turning the allowlist on.");
      // Never let a super admin lock themselves (and everyone) out by mistake.
      if (!ipAllowed(req.ip, buildBlockList(body.entries))) {
        throw badRequest(`This would lock you out: your current address (${normalizeIp(req.ip ?? "")}) isn't in the list. Add it first.`);
      }
    }
    const before = await getIpAllowlist();
    await saveIpAllowlist(body);
    await audit(req, { action: "security.ip_allowlist_update", entityType: "Setting", entityId: "security.ipAllowlist", before, after: body });
    res.json({ data: body });
  }),
);
