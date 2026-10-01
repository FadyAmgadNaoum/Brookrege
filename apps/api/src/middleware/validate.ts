import type { RequestHandler } from "express";
import { ZodError, type ZodTypeAny, type z } from "zod";
import { badRequest } from "../lib/errors";

type Source = "body" | "query" | "params";

/** Validates req[source] and stores the parsed (coerced, stripped) value for handlers. */
export const validate =
  (schema: ZodTypeAny, source: Source = "body"): RequestHandler =>
  (req, _res, next) => {
    try {
      const value = schema.parse(req[source]);
      (req as unknown as Record<string, unknown>)[`valid_${source}`] = value;
      next();
    } catch (e) {
      if (e instanceof ZodError) return next(badRequest("Some fields need attention.", e.flatten().fieldErrors));
      next(e);
    }
  };

export function parsed<S extends ZodTypeAny>(req: unknown, source: Source): z.infer<S> {
  return (req as Record<string, unknown>)[`valid_${source}`] as z.infer<S>;
}
