import type { RequestHandler } from "express";
import { randomUUID } from "node:crypto";
import { logger } from "../lib/logger";

export const requestLog: RequestHandler = (req, res, next) => {
  const start = process.hrtime.bigint();
  const id = (req.get("x-request-id") ?? randomUUID()).slice(0, 64);
  res.setHeader("x-request-id", id);
  res.on("finish", () => {
    const ms = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info("http", { id, method: req.method, path: req.originalUrl, status: res.statusCode, ms: Math.round(ms), user: req.user?.id });
  });
  next();
};
