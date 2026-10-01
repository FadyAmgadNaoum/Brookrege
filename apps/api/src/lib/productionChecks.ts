/**
 * Refuses to start a PRODUCTION server with development secrets or insecure settings.
 * Pure function so it can be unit-tested; env.ts calls it at boot when APP_ENV=production.
 */
export interface ProdEnv {
  JWT_ACCESS_SECRET: string;
  SETTINGS_ENCRYPTION_KEY?: string;
  SETTINGS_ENCRYPTION_KEY_PREVIOUS?: string;
  cookieSecure: boolean;
  PUBLIC_API_URL: string;
  ADMIN_APP_URL: string;
  corsOrigins: string[];
  ADMIN_IP_ALLOWLIST_BYPASS: boolean;
  REDIS_URL?: string;
}

// Markers of the example/dev/CI values shipped in this repository.
const DEV_MARKERS = ["change-me", "changeme", "local-", "local_", "ci-only", "not-for-production", "example", "generate-"];
const DEV_ENCRYPTION_KEYS = ["000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f", "0".repeat(64), "a".repeat(64)];

export function productionProblems(e: ProdEnv): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  const lower = e.JWT_ACCESS_SECRET.toLowerCase();
  if (e.JWT_ACCESS_SECRET.length < 48) errors.push("JWT_ACCESS_SECRET must be at least 48 characters in production (generate: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\").");
  if (DEV_MARKERS.some((m) => lower.includes(m))) errors.push("JWT_ACCESS_SECRET is an example/development value.");
  if (!e.SETTINGS_ENCRYPTION_KEY) errors.push("SETTINGS_ENCRYPTION_KEY is required in production (it encrypts 2FA secrets and provider API keys).");
  else if (DEV_ENCRYPTION_KEYS.includes(e.SETTINGS_ENCRYPTION_KEY.toLowerCase())) errors.push("SETTINGS_ENCRYPTION_KEY is an example/development value.");
  if (e.SETTINGS_ENCRYPTION_KEY && e.SETTINGS_ENCRYPTION_KEY === e.SETTINGS_ENCRYPTION_KEY_PREVIOUS) errors.push("SETTINGS_ENCRYPTION_KEY_PREVIOUS must differ from the current key.");
  if (!e.cookieSecure) errors.push("Session cookies must be Secure in production (remove COOKIE_SECURE=false).");
  for (const [name, url] of [["PUBLIC_API_URL", e.PUBLIC_API_URL], ["ADMIN_APP_URL", e.ADMIN_APP_URL]] as const) {
    if (!url.startsWith("https://")) errors.push(`${name} must use https:// in production.`);
  }
  const insecureOrigins = e.corsOrigins.filter((o) => !o.startsWith("https://"));
  if (insecureOrigins.length) errors.push(`CORS_ORIGINS must all be https:// in production (found ${insecureOrigins.join(", ")}).`);
  if (e.REDIS_URL) {
    let pw = "";
    try { pw = decodeURIComponent(new URL(e.REDIS_URL).password); } catch { errors.push("REDIS_URL is not a valid URL."); }
    if (!pw) errors.push("REDIS_URL must include a password in production (redis://:PASSWORD@host:6379/0).");
    else if (pw.length < 24 || DEV_MARKERS.some((m) => pw.toLowerCase().includes(m))) errors.push("The Redis password is too short or an example value (use 24+ random characters).");
  }
  if (e.ADMIN_IP_ALLOWLIST_BYPASS) warnings.push("ADMIN_IP_ALLOWLIST_BYPASS is on — the admin IP allowlist is ignored. Turn it off after the emergency.");
  return { errors, warnings };
}
