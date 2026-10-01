import type { Prisma } from "@prisma/client";
import { prisma } from "./prisma";
import type { AllowEntry } from "./ipAllowlist";

export interface SecurityPolicy { require2faForAll: boolean }
export interface IpAllowlistSetting { enabled: boolean; entries: AllowEntry[] }

const DEFAULTS = {
  "security.policy": { require2faForAll: false } as SecurityPolicy,
  "security.ipAllowlist": { enabled: false, entries: [] } as IpAllowlistSetting,
};
type Key = keyof typeof DEFAULTS;

/**
 * Read on every admin request, so cached for 15 s per server. A change made on one app server
 * reaches the other within 15 s (saving also clears this server's cache immediately).
 */
const TTL_MS = 15_000;
const cache = new Map<Key, { at: number; value: unknown }>();

async function get<K extends Key>(key: K): Promise<(typeof DEFAULTS)[K]> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as (typeof DEFAULTS)[K];
  const row = await prisma.setting.findUnique({ where: { key } });
  const value = { ...DEFAULTS[key], ...((row?.value as object | null) ?? {}) } as (typeof DEFAULTS)[K];
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function set<K extends Key>(key: K, value: (typeof DEFAULTS)[K]) {
  const json = value as unknown as Prisma.InputJsonObject;
  await prisma.setting.upsert({ where: { key }, create: { key, value: json }, update: { value: json } });
  cache.set(key, { at: Date.now(), value });
}

export const getSecurityPolicy = () => get("security.policy");
export const saveSecurityPolicy = (v: SecurityPolicy) => set("security.policy", v);
export const getIpAllowlist = () => get("security.ipAllowlist");
export const saveIpAllowlist = (v: IpAllowlistSetting) => set("security.ipAllowlist", v);

/** Tests reset the database between cases; this clears the matching in-memory copy. */
export const clearSecuritySettingsCache = () => cache.clear();
