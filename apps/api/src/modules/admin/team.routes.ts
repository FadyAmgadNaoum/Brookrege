import { Router } from "express";
import { z } from "zod";
import { passwordProblems, ROLES } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { badRequest, notFound } from "../../lib/errors";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { hashPassword, revokeSessions, securityAlert } from "../auth/auth.service";
import { events } from "../notifications/notify.service";

export const adminTeamRouter = Router();
adminTeamRouter.use(requirePermission("team:manage"));

const safe = {
  id: true, email: true, name: true, role: true, status: true, lastLoginAt: true, createdAt: true,
  twoFactorEnabled: true, lockedUntil: true, mustChangePassword: true,
} as const;
const idParam = z.object({ id: z.string().min(1).max(40) });

/** Same policy the person will face when they change it themselves (packages/domain/src/security.ts). */
function checkPassword(pw: string, ctx: { email: string; name: string }) {
  const problems = passwordProblems(pw, ctx);
  if (problems.length) throw badRequest(problems[0]!, { password: problems });
}

adminTeamRouter.get("/", asyncHandler(async (_req, res) => {
  res.json({ data: await prisma.user.findMany({ select: safe, orderBy: { createdAt: "asc" } }) });
}));

const createBody = z.object({ email: z.string().trim().toLowerCase().email(), name: z.string().trim().min(2).max(100), role: z.enum(ROLES), password: z.string().max(200) });

/** New people get a temporary password and must choose their own at first sign-in. */
adminTeamRouter.post("/", validate(createBody), asyncHandler(async (req, res) => {
  const { password: pw, ...body } = parsed<typeof createBody>(req, "body");
  checkPassword(pw, body);
  const user = await prisma.user.create({ data: { ...body, passwordHash: await hashPassword(pw), mustChangePassword: true }, select: safe });
  await audit(req, { action: "team.create", entityType: "User", entityId: user.id, after: user });
  await events.teamMemberCreated(user).catch(() => undefined); // welcome email (the password is never emailed)
  res.status(201).json({ data: user });
}));

const patchBody = z.object({
  name: z.string().trim().min(2).max(100).optional(),
  role: z.enum(ROLES).optional(),
  status: z.enum(["ACTIVE", "SUSPENDED"]).optional(),
  password: z.string().max(200).optional(),
});

adminTeamRouter.patch("/:id", validate(idParam, "params"), validate(patchBody), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const { password: pw, ...body } = parsed<typeof patchBody>(req, "body");
  const before = await prisma.user.findUnique({ where: { id }, select: safe });
  if (!before) throw notFound("Team member");
  if (pw) checkPassword(pw, { email: before.email, name: body.name ?? before.name });

  // Never let the system end up with zero active super admins.
  const demotingSuper = before.role === "SUPER_ADMIN" && ((body.role && body.role !== "SUPER_ADMIN") || body.status === "SUSPENDED");
  if (demotingSuper) {
    const others = await prisma.user.count({ where: { role: "SUPER_ADMIN", status: "ACTIVE", id: { not: id } } });
    if (others === 0) throw badRequest("Add another active super admin before changing this one.");
  }

  const user = await prisma.user.update({
    where: { id },
    // An admin-set password is temporary: the person must replace it at next sign-in.
    data: { ...body, ...(pw ? { passwordHash: await hashPassword(pw), mustChangePassword: true, passwordChangedAt: new Date() } : {}) },
    select: safe,
  });
  if (pw || body.status === "SUSPENDED" || (body.role && body.role !== before.role)) {
    await revokeSessions({ userId: id }, pw ? "password_changed" : body.status === "SUSPENDED" ? "admin" : "role_changed");
  }
  await audit(req, { action: pw ? "team.update_with_password" : "team.update", entityType: "User", entityId: id, before, after: user });
  if (pw) await securityAlert(user, "A super admin set a new temporary password for your account. You'll be asked to choose your own at next sign-in.", req);
  res.json({ data: user });
}));

/** Lost phone: turn 2FA off so the person can set it up again (they're forced to if their role requires it). */
adminTeamRouter.post("/:id/reset-2fa", validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  if (id === req.user!.id) throw badRequest("You can't reset your own two-step verification here. Use My account, or ask another super admin.");
  const user = await prisma.user.findUnique({ where: { id }, select: safe });
  if (!user) throw notFound("Team member");
  await prisma.$transaction([
    prisma.user.update({ where: { id }, data: { twoFactorEnabled: false, twoFactorEnabledAt: null, totpSecret: null, totpPendingSecret: null, totpLastStep: null } }),
    prisma.backupCode.deleteMany({ where: { userId: id } }),
  ]);
  const ended = await revokeSessions({ userId: id }, "2fa_changed");
  await audit(req, { action: "team.2fa_reset", entityType: "User", entityId: id, after: { sessionsEnded: ended } });
  await securityAlert(user, "A super admin reset your two-step verification. Set it up again at your next sign-in.", req);
  res.json({ data: { reset: true } });
}));

adminTeamRouter.post("/:id/unlock", validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const user = await prisma.user.update({ where: { id }, data: { lockedUntil: null, failedLoginCount: 0 }, select: safe });
  await audit(req, { action: "team.unlock", entityType: "User", entityId: id });
  res.json({ data: user });
}));

adminTeamRouter.post("/:id/sign-out", validate(idParam, "params"), asyncHandler(async (req, res) => {
  const { id } = parsed<typeof idParam>(req, "params");
  const ended = await revokeSessions({ userId: id, exceptSessionId: req.auth?.sessionId }, "admin");
  await audit(req, { action: "team.sign_out", entityType: "User", entityId: id, after: { sessionsEnded: ended } });
  res.json({ data: { ended } });
}));
