import winston from "winston";
import { env } from "../config/env";

export const logger = winston.createLogger({
  level: env.isProd ? "info" : "debug",
  format: env.isProd
    ? winston.format.combine(winston.format.timestamp(), winston.format.json())
    : winston.format.combine(winston.format.colorize(), winston.format.simple()),
  transports: [new winston.transports.Console()],
  silent: env.NODE_ENV === "test",
});
