import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Express 4 does not forward rejected promises; this does. It also records the matched route pattern
 * (e.g. "/api/admin/properties/:id") for metrics — after an error Express has already reset req.baseUrl.
 */
export const asyncHandler =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    if (req.route?.path && !res.locals.route) res.locals.route = `${req.baseUrl}${req.route.path === "/" && req.baseUrl ? "" : req.route.path}`;
    fn(req, res, next).catch(next);
  };
