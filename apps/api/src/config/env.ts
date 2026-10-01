import { hostname } from "node:os";
import { z } from "zod";
import { productionProblems } from "../lib/productionChecks";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  /** Where this runs. "production" enables strict start-up checks. Docker images default to production; local stacks set "local". */
  APP_ENV: z.enum(["production", "staging", "local", "development", "test"]).optional(),
  PORT: z.coerce.number().int().default(4000),
  DATABASE_URL: z.string().url(),
  /** Optional read replica (Phase 2). Public read-only endpoints use it; falls back to primary if unreachable. */
  DATABASE_REPLICA_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  /** Name of this app server, returned in the X-Instance header (load-balancer tests, logs). */
  INSTANCE_ID: z.string().max(40).default(hostname()),
  JWT_ACCESS_SECRET: z.string().min(32, "JWT_ACCESS_SECRET must be at least 32 characters"),
  ACCESS_TOKEN_TTL_MIN: z.coerce.number().int().min(5).max(60).default(15),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  CORS_ORIGINS: z.string().default("http://localhost:3000,http://localhost:3001"),
  PUBLIC_API_URL: z.string().url().default("http://localhost:4000"),
  UPLOAD_DIR: z.string().default("./uploads"),
  EXPIRY_CRON: z.string().default("0 2 * * *"),
  TZ_NAME: z.string().default("Africa/Cairo"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
  // ── Phase 2: media storage ──
  STORAGE_DRIVER: z.enum(["local", "r2"]).default("local"),
  /** Public base URL of stored media. Local: <PUBLIC_API_URL>/uploads. R2: the bucket's custom domain behind Cloudflare, e.g. https://media.brookrege.com */
  PUBLIC_MEDIA_BASE_URL: z.string().url().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // ── Phase 2: background jobs & notifications ──
  /** Run the job worker inside this API process. Set "false" on servers that only serve HTTP. */
  JOBS_WORKER: z.enum(["true", "false"]).default("true"),
  JOBS_CONCURRENCY: z.coerce.number().int().min(1).max(20).default(4),
  /** 32-byte key (64 hex chars) that encrypts provider API keys saved from the admin. */
  SETTINGS_ENCRYPTION_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, "SETTINGS_ENCRYPTION_KEY must be 64 hex characters").optional(),
  ADMIN_APP_URL: z.string().url().default("http://localhost:3001"),
  // ── Phase 3: security ──
  /** Previous encryption key during a key rotation (see docs/security/KEY-ROTATION.md). */
  SETTINGS_ENCRYPTION_KEY_PREVIOUS: z.string().regex(/^[0-9a-fA-F]{64}$/).optional().or(z.literal("").transform(() => undefined)),
  /** Admin sessions end after this much inactivity (architecture: 1 hour). */
  SESSION_IDLE_MINUTES: z.coerce.number().int().min(5).max(24 * 60).default(60),
  /** …and always after this long, even if active. */
  SESSION_MAX_HOURS: z.coerce.number().int().min(1).max(7 * 24).default(12),
  /** bcrypt cost. 12 ≈ 250 ms per hash on a VPS core; existing hashes are upgraded at next sign-in. */
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(15).default(12),
  /** Sign-in attempts allowed per network address per 15 minutes, per app server (account lockout is separate). */
  SIGNIN_RATE_LIMIT: z.coerce.number().int().min(1).max(10_000).default(10),
  /** Extra origins allowed to call the admin API (comma-separated). The ADMIN_APP_URL origin is always allowed. */
  ADMIN_EXTRA_ORIGINS: z.string().default(""),
  /** EMERGENCY ONLY: ignore the admin IP allowlist (e.g. office IP changed and everyone is locked out). */
  ADMIN_IP_ALLOWLIST_BYPASS: z.enum(["true", "false"]).default("false").transform((v) => v === "true"),
  // ── Phase 4: monitoring & performance ──
  /** Prometheus metrics on a separate port (0 = off). Publish it only on the private network or 127.0.0.1. */
  METRICS_PORT: z.coerce.number().int().min(0).max(65535).default(9464),
  METRICS_HOST: z.string().default("0.0.0.0"),
  /** Optional: Prometheus must send "Authorization: Bearer <token>". */
  METRICS_TOKEN: z.string().min(16).optional().or(z.literal("").transform(() => undefined)),
  /** Build identifier shown in brookrege_app_info (the Docker build sets the git commit). */
  APP_VERSION: z.string().max(64).default("dev"),
  /** Shared cache (Redis). Optional: without it each API server caches in memory only. e.g. redis://:PASSWORD@10.0.0.3:6379/0 */
  REDIS_URL: z.string().url().optional().or(z.literal("").transform(() => undefined)),
  CACHE_ENABLED: z.enum(["true", "false"]).default("true").transform((v) => v === "true"),
  /** How long each server keeps an entry in memory (the Redis copy lives longer; changes clear both). */
  CACHE_L1_TTL_SECONDS: z.coerce.number().int().min(1).max(600).default(30),
});

const parsed = schema
  .superRefine((v, ctx) => {
    if (v.STORAGE_DRIVER === "r2")
      for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "PUBLIC_MEDIA_BASE_URL"] as const)
        if (!v[k]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [k], message: `${k} is required when STORAGE_DRIVER=r2` });
  })
  .safeParse(process.env);
if (!parsed.success) {
  // Fail fast on boot: a misconfigured server must never start.
  console.error("Invalid environment configuration:", parsed.error.flatten().fieldErrors);
  process.exit(1);
}

const appEnv = parsed.data.APP_ENV ?? (parsed.data.NODE_ENV === "production" ? "production" : parsed.data.NODE_ENV);

export const env = {
  ...parsed.data,
  appEnv,
  corsOrigins: parsed.data.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  adminExtraOrigins: parsed.data.ADMIN_EXTRA_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
  isProd: parsed.data.NODE_ENV === "production",
  cookieSecure: parsed.data.COOKIE_SECURE ? parsed.data.COOKIE_SECURE === "true" : parsed.data.NODE_ENV === "production",
};

// Staging runs the same checks: it is a copy of production, reachable from the internet.
if (appEnv === "production" || appEnv === "staging") {
  const { errors, warnings } = productionProblems(env);
  for (const w of warnings) console.warn(`[security] ${w}`);
  if (errors.length) {
    console.error(`Refusing to start: this server is configured as ${appEnv} (APP_ENV) but has insecure settings:\n - ${errors.join("\n - ")}`);
    process.exit(1);
  }
}
