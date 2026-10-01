import { Router } from "express";
import { authenticate, requireFullAccess } from "../../middleware/auth";
import { ipAllowlistGuard, requireAdminOrigin } from "../../middleware/adminGuards";
import { adminSecurityRouter } from "../security/security.routes";
import { adminPrivacyRouter } from "../privacy/privacy.routes";
import { authRouter } from "../auth/auth.routes";
import { adminCatalogRouter } from "./catalog.routes";
import { adminLeadsRouter } from "./leads.routes";
import { adminPropertiesRouter } from "./properties.routes";
import { adminSystemRouter } from "./system.routes";
import { adminTeamRouter } from "./team.routes";
import { adminMediaRouter } from "../media/media.routes";
import { adminAnalyticsRouter } from "../analytics/analytics.routes";
import { adminNotificationsRouter } from "../notifications/notifications.routes";
import { invalidatePublicOnWrite } from "../../lib/appCache";

export const adminRouter = Router();

// Admin responses are private and must never be cached by Nginx/Cloudflare/browser.
adminRouter.use((_req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

// Order matters: network/origin checks → sign-in endpoints → session check → mandatory-steps gate → features.
adminRouter.use(ipAllowlistGuard);
adminRouter.use(requireAdminOrigin);
adminRouter.use("/auth", authRouter);
adminRouter.use(authenticate);
adminRouter.use(requireFullAccess);
adminRouter.use("/security", adminSecurityRouter);
adminRouter.use("/privacy", adminPrivacyRouter);
// Changes to listings, photos and the catalog clear the public cache (lib/appCache.ts).
adminRouter.use(["/properties", "/catalog", "/media"], invalidatePublicOnWrite);
adminRouter.use("/properties", adminPropertiesRouter);
adminRouter.use("/", adminLeadsRouter);
adminRouter.use("/catalog", adminCatalogRouter);
adminRouter.use("/team", adminTeamRouter);
adminRouter.use("/", adminSystemRouter);
adminRouter.use("/media", adminMediaRouter);
adminRouter.use("/", adminAnalyticsRouter);
adminRouter.use("/", adminNotificationsRouter);
