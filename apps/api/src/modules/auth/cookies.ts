import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";

/*
 * Production (Secure) cookies use browser-enforced prefixes:
 *  __Host-  → only ever sent to the exact admin host, over HTTPS, for every path. It can't be set
 *             for the parent domain, so the public site (a sibling subdomain) never receives it.
 *  __Secure-→ HTTPS only; used where a narrower path is needed (the refresh token).
 * Plain names are used on http://localhost, where browsers reject prefixed cookies.
 */
const secure = env.cookieSecure;
export const ACCESS_COOKIE = secure ? "__Host-bk_at" : "bk_at";
export const REFRESH_COOKIE = secure ? "__Secure-bk_rt" : "bk_rt";
const AUTH_PATH = "/api/admin/auth";

// SameSite=Strict: admin requests always come from the admin app itself, never from another site.
const base: CookieOptions = { httpOnly: true, secure, sameSite: "strict" };

export function setAuthCookies(res: Response, access: string, refresh: string) {
  res.cookie(ACCESS_COOKIE, access, { ...base, path: "/", maxAge: env.ACCESS_TOKEN_TTL_MIN * 60_000 });
  // The refresh cookie only travels to the sign-in endpoints, never to the rest of the API.
  res.cookie(REFRESH_COOKIE, refresh, { ...base, path: AUTH_PATH, maxAge: env.SESSION_MAX_HOURS * 3_600_000 });
}

export function clearAuthCookies(res: Response) {
  res.clearCookie(ACCESS_COOKIE, { ...base, path: "/" });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: AUTH_PATH });
}
