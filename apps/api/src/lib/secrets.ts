import { env } from "../config/env";
import { badRequest } from "./errors";
import { openWithAny, seal } from "./secretBox";

/** Encrypts a secret for storage (provider API keys) with SETTINGS_ENCRYPTION_KEY. */
export function sealSecret(plain: string): string {
  if (!env.SETTINGS_ENCRYPTION_KEY) throw badRequest("The server has no SETTINGS_ENCRYPTION_KEY, so secrets can't be stored. Ask your administrator to set it.");
  return seal(plain, env.SETTINGS_ENCRYPTION_KEY);
}

/** Decrypts with the current key, falling back to SETTINGS_ENCRYPTION_KEY_PREVIOUS during a rotation. */
export function openSecret(sealed: string): string {
  return openWithAny(sealed, [env.SETTINGS_ENCRYPTION_KEY, env.SETTINGS_ENCRYPTION_KEY_PREVIOUS]);
}

export const canStoreSecrets = () => Boolean(env.SETTINGS_ENCRYPTION_KEY);
