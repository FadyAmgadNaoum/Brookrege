import type { RequestHandler } from "express";
import { normalizeRoute, statusClass } from "../lib/metrics";
import { httpDuration, httpInFlight, httpRequests } from "../metrics/registry";

/** Counts every request and its duration, labelled by route pattern (never the raw URL). */
export const httpMetrics: RequestHandler = (req, res, next) => {
  const stop = httpDuration.startTimer();
  httpInFlight.inc();
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    httpInFlight.dec();
    const route = (res.locals.route as string | undefined) ?? normalizeRoute(req.baseUrl, req.route?.path);
    const method = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"].includes(req.method) ? req.method : "OTHER";
    httpRequests.inc({ method, route, status: statusClass(res.statusCode) });
    stop({ method, route });
  };
  res.on("finish", finish);
  res.on("close", finish); // client went away before the response finished
  next();
};
