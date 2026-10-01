import { Router } from "express";
import { z } from "zod";
import { PRIVACY_LIMITS } from "@brookrege/domain";
import { asyncHandler } from "../../lib/asyncHandler";
import { audit } from "../../lib/audit";
import { prisma } from "../../lib/prisma";
import { requirePermission } from "../../middleware/auth";
import { parsed, validate } from "../../middleware/validate";
import { eraseSubject, exportSubject, findSubject, getLastRetentionRun, getPrivacyPolicy, runRetention, savePrivacyPolicy } from "./privacy.service";

/**
 * Admin › Privacy (super admins): retention settings and requests from people about their data.
 * Phone numbers and emails travel in POST bodies, never in URLs, so they don't end up in access logs.
 */
export const adminPrivacyRouter = Router();
adminPrivacyRouter.use(requirePermission("privacy:manage"));

adminPrivacyRouter.get(
  "/overview",
  asyncHandler(async (_req, res) => {
    const [policy, lastRun, inquiries, submissions, anonymizedInquiries, anonymizedSubmissions] = await Promise.all([
      getPrivacyPolicy(), getLastRetentionRun(),
      prisma.inquiry.count(), prisma.propertySubmission.count(),
      prisma.inquiry.count({ where: { anonymizedAt: { not: null } } }), prisma.propertySubmission.count({ where: { anonymizedAt: { not: null } } }),
    ]);
    res.json({ data: { policy, limits: PRIVACY_LIMITS, lastRun, counts: { inquiries, submissions, anonymizedInquiries, anonymizedSubmissions } } });
  }),
);

const policyBody = z.object({
  leadRetentionMonths: z.number().int().min(PRIVACY_LIMITS.leadRetentionMonths[0]).max(PRIVACY_LIMITS.leadRetentionMonths[1]),
  logRetentionMonths: z.number().int().min(PRIVACY_LIMITS.logRetentionMonths[0]).max(PRIVACY_LIMITS.logRetentionMonths[1]),
}).strict();

adminPrivacyRouter.put(
  "/policy",
  validate(policyBody),
  asyncHandler(async (req, res) => {
    const before = await getPrivacyPolicy();
    const after = parsed<typeof policyBody>(req, "body");
    await savePrivacyPolicy(after);
    await audit(req, { action: "privacy.policy_update", entityType: "Privacy", before, after });
    res.json({ data: after });
  }),
);

adminPrivacyRouter.post(
  "/retention/run",
  asyncHandler(async (req, res) => {
    const run = await runRetention("manual");
    await audit(req, { action: "privacy.retention_manual", entityType: "Privacy", after: run });
    res.json({ data: run });
  }),
);

const subjectBody = z.object({
  phone: z.string().trim().max(30).optional().transform((v) => v || undefined),
  email: z.string().trim().max(200).email().optional().or(z.literal("").transform(() => undefined)),
}).strict();

adminPrivacyRouter.post(
  "/lookup",
  validate(subjectBody),
  asyncHandler(async (req, res) => {
    res.json({ data: await findSubject(parsed<typeof subjectBody>(req, "body")) });
  }),
);

adminPrivacyRouter.post(
  "/export",
  validate(subjectBody),
  asyncHandler(async (req, res) => {
    const data = await exportSubject(req, parsed<typeof subjectBody>(req, "body"));
    res.set("Content-Disposition", `attachment; filename="brookrege-personal-data-${new Date().toISOString().slice(0, 10)}.json"`);
    res.json(data);
  }),
);

const eraseBody = subjectBody.extend({ confirm: z.literal("ERASE", { errorMap: () => ({ message: 'Type ERASE to confirm.' }) }) });

adminPrivacyRouter.post(
  "/erase",
  validate(eraseBody),
  asyncHandler(async (req, res) => {
    const { confirm: _c, ...subject } = parsed<typeof eraseBody>(req, "body");
    res.json({ data: await eraseSubject(req, subject) });
  }),
);
