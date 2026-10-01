import type { RequestHandler } from "express";
import { env } from "../config/env";
import { audit } from "../lib/audit";
import { AppError } from "../lib/errors";
import { buildBlockList, ipAllowed, normalizeIp } from "../lib/ipAllowlist";
import { logger } from "../lib/logger";
import { getIpAllowlist } from "../lib/securitySettings";
import { securityBlocks } from "../metrics/registry";

/**
 * Only the admin app's own origin may use the admin API from a browser.
 * The public site (brookrege.com) and the admin (admin.brookrege.com) are the same *site*, so
 * SameSite cookies alone don't separate them; this check does. Browsers always send Origin on
 * cross-origin requests and Sec-Fetch-Site on all modern requests. Non-browser clients (tests,
 * curl) send neither and are unaffected — they still need a valid session.
 */
export const adminOrigins = () => [...new Set([new URL(env.ADMIN_APP_URL).origin, ...env.adminExtraOrigins])];

export const requireAdminOrigin: RequestHandler = (req, _res, next) => {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  const origin = req.get("origin");
  const site = req.get("sec-fetch-site");
  const allowed = origin ? adminOrigins().includes(origin) : site === undefined || site === "same-origin" || site === "none";
  if (allowed) return next();
  logger.warn("admin_origin_rejected", { origin, site, path: req.path, ip: req.ip });
  securityBlocks.inc({ reason: "origin" });
  next(new AppError(403, "BAD_ORIGIN", "This request didn't come from the Brookrege admin."));
};

/** One "blocked" audit entry per address per 10 minutes, so a scanner can't flood the activity log. */
const recentlyLogged = new Map<string, number>();

/**
 * Optional admin IP allowlist (Admin › Security). When on, the admin API only answers the listed
 * addresses/ranges — including the sign-in endpoint. Emergency override: ADMIN_IP_ALLOWLIST_BYPASS=true.
 */
export const ipAllowlistGuard: RequestHandler = (req, _res, next) => {
  if (env.ADMIN_IP_ALLOWLIST_BYPASS) return next();
  getIpAllowlist()
    .then(async (cfg) => {
      if (!cfg.enabled || !cfg.entries.length) return next();
      if (ipAllowed(req.ip, buildBlockList(cfg.entries))) return next();
      const ip = normalizeIp(req.ip ?? "unknown");
      const last = recentlyLogged.get(ip) ?? 0;
      if (Date.now() - last > 10 * 60_000) {
        recentlyLogged.set(ip, Date.now());
        if (recentlyLogged.size > 5000) recentlyLogged.clear();
        await audit(req, { action: "security.ip_blocked", entityType: "Security", after: { ip, path: req.path } });
      }
      securityBlocks.inc({ reason: "ip_allowlist" });
      next(new AppError(403, "IP_NOT_ALLOWED", `The admin can't be used from this network (${ip}). Ask a super admin to add it to the allowed list.`));
    })
    .catch(next);
};
