import type { RequestHandler } from "express";
import { badRequest } from "../lib/errors";

/** PostgreSQL text can't contain NUL (\u0000); without this, such input would surface as a 500 error. */
function hasNul(v: unknown, depth = 0): boolean {
  if (depth > 20) return false;
  if (typeof v === "string") return v.includes("\u0000");
  if (Array.isArray(v)) return v.some((x) => hasNul(x, depth + 1));
  if (v && typeof v === "object") return Object.entries(v).some(([k, x]) => k.includes("\u0000") || hasNul(x, depth + 1));
  return false;
}

export const rejectNullBytes: RequestHandler = (req, _res, next) => {
  let url = req.originalUrl;
  try { url = decodeURIComponent(url); } catch { return next(badRequest("The address contains invalid characters.")); }
  if (url.includes("\u0000") || hasNul(req.body) || hasNul(req.query)) return next(badRequest("The request contains invalid characters."));
  next();
};
