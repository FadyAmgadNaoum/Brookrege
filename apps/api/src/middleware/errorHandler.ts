import type { ErrorRequestHandler, RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { MulterError } from "multer";
import { AppError } from "../lib/errors";
import { logger } from "../lib/logger";

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({ error: { code: "NOT_FOUND", message: "Route not found." } });
};

export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, details: err.details } });
  }
  if (err instanceof MulterError) {
    const message = err.code === "LIMIT_FILE_SIZE" ? "Each image must be 8 MB or smaller." : "Upload failed: " + err.message;
    return res.status(400).json({ error: { code: "UPLOAD_ERROR", message } });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") return res.status(409).json({ error: { code: "CONFLICT", message: "A record with this value already exists." } });
    if (err.code === "P2025") return res.status(404).json({ error: { code: "NOT_FOUND", message: "Record not found." } });
    if (err.code === "P2003") return res.status(400).json({ error: { code: "BAD_REFERENCE", message: "A referenced record does not exist." } });
  }
  if (err?.type === "entity.too.large") {
    return res.status(413).json({ error: { code: "PAYLOAD_TOO_LARGE", message: "Request is too large." } });
  }
  // Client errors raised by Express/body-parser (malformed JSON, bad encoding, …): answer 4xx, never 500.
  const status = typeof err?.status === "number" ? err.status : typeof err?.statusCode === "number" ? err.statusCode : 0;
  if (status >= 400 && status < 500) {
    return res.status(status).json({ error: { code: "BAD_REQUEST", message: "The request couldn't be read. Check the data you sent." } });
  }
  logger.error("unhandled_error", { message: err?.message, stack: err?.stack, path: req.path, method: req.method });
  res.status(500).json({ error: { code: "INTERNAL", message: "Something went wrong on our side. Try again shortly." } });
};
