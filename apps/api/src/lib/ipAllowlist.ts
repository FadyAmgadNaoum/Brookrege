import { BlockList, isIP } from "node:net";

/** An allowed address: single IP ("41.33.10.5", "2c0f:fc88::1") or range ("41.33.10.0/24", "2c0f:fc88::/32"). */
export interface AllowEntry { value: string; label?: string | null }

/** Express may report IPv4 clients as IPv4-mapped IPv6 ("::ffff:1.2.3.4"); compare them as IPv4. */
export function normalizeIp(ip: string): string {
  const noZone = ip.split("%")[0]!;
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(noZone);
  return m ? m[1]! : noZone;
}

export type ParsedEntry = { ok: true; family: "ipv4" | "ipv6"; address: string; prefix: number } | { ok: false; error: string };

export function parseEntry(value: string): ParsedEntry {
  const [addrRaw, prefixRaw, extra] = value.trim().split("/");
  if (extra !== undefined || !addrRaw) return { ok: false, error: `“${value}” isn't an IP address or range.` };
  const address = normalizeIp(addrRaw);
  const v = isIP(address);
  if (!v) return { ok: false, error: `“${value}” isn't an IP address or range.` };
  const max = v === 4 ? 32 : 128;
  const prefix = prefixRaw === undefined ? max : Number(prefixRaw);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > max || (prefixRaw !== undefined && !/^\d+$/.test(prefixRaw))) {
    return { ok: false, error: `The range in “${value}” must be /0–/${max}.` };
  }
  // A /0 (or a very wide range) would effectively disable the allowlist.
  if (prefix < (v === 4 ? 8 : 16)) return { ok: false, error: `“${value}” is too wide to be a meaningful restriction.` };
  return { ok: true, family: v === 4 ? "ipv4" : "ipv6", address, prefix };
}

export function buildBlockList(entries: AllowEntry[]): BlockList {
  const list = new BlockList();
  for (const e of entries) {
    const p = parseEntry(e.value);
    if (!p.ok) continue; // invalid entries are rejected on save; skip defensively
    if ((p.family === "ipv4" && p.prefix === 32) || (p.family === "ipv6" && p.prefix === 128)) list.addAddress(p.address, p.family);
    else list.addSubnet(p.address, p.prefix, p.family);
  }
  return list;
}

export function ipAllowed(ip: string | undefined, list: BlockList): boolean {
  if (!ip) return false;
  const addr = normalizeIp(ip);
  const v = isIP(addr);
  if (!v) return false;
  return list.check(addr, v === 4 ? "ipv4" : "ipv6");
}
