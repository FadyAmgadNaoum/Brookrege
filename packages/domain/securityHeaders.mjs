// Browser security headers for the Next.js apps (imported by apps/web and apps/admin next.config.mjs).
// Plain JavaScript on purpose: next.config.mjs loads it at build time without TypeScript.

/**
 * @param {{ apiUrl?: string, dev?: boolean, allowFraming?: boolean, extraConnect?: string[] }} o
 * @returns {{ key: string, value: string }[]}
 */
export function securityHeaders({ apiUrl = "", dev = false, allowFraming = false, extraConnect = [] } = {}) {
  let api = "";
  try { api = apiUrl ? new URL(apiUrl).origin : ""; } catch { api = ""; }
  const https = !dev && (api === "" || api.startsWith("https://"));
  const src = (...xs) => xs.filter(Boolean).join(" ");

  const csp = [
    `default-src 'self'`,
    // Next.js inlines small bootstrap scripts, and the theme script must run before paint, so inline
    // scripts are allowed; scripts from any OTHER origin are not. (A nonce-based policy is the next step.)
    `script-src ${src("'self'", "'unsafe-inline'", dev && "'unsafe-eval'")}`,
    `style-src 'self' 'unsafe-inline'`,
    // Photos come from our API/CDN; map tiles from the map provider — any HTTPS image host is allowed.
    `img-src ${src("'self'", "data:", "blob:", "https:", api)}`,
    `media-src ${src("'self'", "blob:", "https:", api)}`,
    `font-src 'self' data:`,
    `connect-src ${src("'self'", api, dev && "ws:", ...extraConnect)}`,
    `worker-src 'self' blob:`,
    `frame-src 'none'`,
    `frame-ancestors ${allowFraming ? "'self'" : "'none'"}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    https && `upgrade-insecure-requests`,
  ].filter(Boolean).join("; ");

  return [
    { key: "Content-Security-Policy", value: csp },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "X-Frame-Options", value: allowFraming ? "SAMEORIGIN" : "DENY" },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
  ];
}
