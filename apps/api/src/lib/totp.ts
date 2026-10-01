import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Time-based one-time passwords (RFC 6238) — the 6-digit codes shown by Google Authenticator,
 * Microsoft Authenticator, 1Password, Authy, etc. Implemented on Node's crypto (no dependency)
 * and tested against the RFC test vectors.
 */
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 secret.");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

/** 160-bit secret, as recommended by RFC 4226. */
export const generateTotpSecret = () => base32Encode(randomBytes(20));

/** Groups of 4 for manual entry: "JBSW Y3DP EHPK 3PXP". */
export const formatSecret = (s: string) => s.match(/.{1,4}/g)!.join(" ");

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac("sha1", secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const bin = ((mac[offset]! & 0x7f) << 24) | (mac[offset + 1]! << 16) | (mac[offset + 2]! << 8) | mac[offset + 3]!;
  return String(bin % 10 ** digits).padStart(digits, "0");
}

export const stepAt = (ms: number) => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);

export function totpAt(secretB32: string, ms: number, digits = TOTP_DIGITS) {
  return hotp(base32Decode(secretB32), stepAt(ms), digits);
}

const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

export type TotpResult = { ok: true; step: number } | { ok: false; reason: "format" | "invalid" | "replay" };

/**
 * Accepts the current code and one step either side (±30 s clock drift).
 * `lastUsedStep` blocks replay: a code that was already accepted can't be used again.
 */
export function verifyTotp(secretB32: string, code: string, opts: { now?: number; window?: number; lastUsedStep?: number | null } = {}): TotpResult {
  const clean = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(clean)) return { ok: false, reason: "format" };
  const secret = base32Decode(secretB32);
  const current = stepAt(opts.now ?? Date.now());
  const window = opts.window ?? 1;
  for (let d = -window; d <= window; d++) {
    const step = current + d;
    if (safeEqual(hotp(secret, step), clean)) {
      if (opts.lastUsedStep != null && step <= opts.lastUsedStep) return { ok: false, reason: "replay" };
      return { ok: true, step };
    }
  }
  return { ok: false, reason: "invalid" };
}

export function otpauthUrl(p: { secret: string; account: string; issuer: string }) {
  const label = encodeURIComponent(`${p.issuer}:${p.account}`);
  const q = new URLSearchParams({ secret: p.secret, issuer: p.issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${q.toString()}`;
}
