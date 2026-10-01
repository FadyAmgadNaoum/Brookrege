import { randomInt } from "node:crypto";

/**
 * One-time backup codes for when the phone is lost: 10 codes like "k7mq-2xrf".
 * Alphabet has no look-alikes (0/o, 1/l/i). 8 chars × 5 bits = 40 bits each; stored bcrypt-hashed
 * so a database leak can't be turned back into codes, and each works once.
 */
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789".replace(/[ilo01]/g, ""); // 31 chars
export const BACKUP_CODE_COUNT = 10;

export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) {
    let c = "";
    for (let i = 0; i < 8; i++) c += ALPHABET[randomInt(ALPHABET.length)];
    codes.add(`${c.slice(0, 4)}-${c.slice(4)}`);
  }
  return [...codes];
}

/** Accepts "K7MQ 2XRF", "k7mq2xrf", "k7mq-2xrf" → "k7mq-2xrf". Returns null if it can't be a backup code. */
export function normalizeBackupCode(input: string): string | null {
  const c = input.toLowerCase().replace(/[\s-]/g, "");
  if (c.length !== 8 || [...c].some((ch) => !ALPHABET.includes(ch))) return null;
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}
