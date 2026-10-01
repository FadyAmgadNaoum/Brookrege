import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * AES-256-GCM for secrets stored in the database (SendGrid / Twilio keys entered in the admin).
 * Format: "v1:<iv b64>:<tag b64>:<ciphertext b64>". GCM authenticates, so tampering is detected.
 */
export function seal(plaintext: string, keyHex: string): string {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes (64 hex characters).");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), enc.toString("base64")].join(":");
}

export function open(sealed: string, keyHex: string): string {
  const [v, iv, tag, data] = sealed.split(":");
  if (v !== "v1" || !iv || !tag || !data) throw new Error("Unrecognised secret format.");
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/**
 * Key rotation: try the current key, then the previous one. After rotating, run
 * `node dist/scripts/rotateEncryptionKey.js` to re-seal everything with the current key.
 */
export function openWithAny(sealed: string, keys: (string | undefined)[]): string {
  let last: unknown = new Error("No encryption key configured.");
  for (const k of keys) {
    if (!k) continue;
    try { return open(sealed, k); } catch (e) { last = e; }
  }
  throw last;
}

/** Re-encrypts with `newKey` (reading with any of `oldKeys`). Returns null if it's already sealed with newKey. */
export function reseal(sealed: string, newKey: string, oldKeys: (string | undefined)[]): string | null {
  try { open(sealed, newKey); return null; } catch { /* not yet under the new key */ }
  return seal(openWithAny(sealed, oldKeys), newKey);
}

/** For display: "••••••••3f9a". */
export const mask = (secret: string) => `••••••••${secret.slice(-4)}`;
