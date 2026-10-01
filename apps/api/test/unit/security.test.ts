import { test } from "node:test";
import assert from "node:assert/strict";
import { base32Decode, base32Encode, formatSecret, generateTotpSecret, hotp, otpauthUrl, stepAt, totpAt, verifyTotp } from "../../src/lib/totp";
import { generateBackupCodes, normalizeBackupCode } from "../../src/lib/backupCodes";
import { buildBlockList, ipAllowed, normalizeIp, parseEntry } from "../../src/lib/ipAllowlist";
import { openWithAny, seal } from "../../src/lib/secretBox";

const RFC_SECRET = Buffer.from("12345678901234567890"); // RFC 4226 / 6238 test key (SHA-1)

test("HOTP matches RFC 4226 appendix D", () => {
  const expected = ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SECRET, counter), code));
});

test("TOTP matches RFC 6238 appendix B (SHA-1, 8 digits)", () => {
  const b32 = base32Encode(RFC_SECRET);
  const vectors: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
  for (const [t, code] of vectors) assert.equal(totpAt(b32, t * 1000, 8), code, `T=${t}`);
});

test("base32 round-trip and known value", () => {
  assert.equal(base32Encode(Buffer.from("foobar")), "MZXW6YTBOI");
  assert.equal(base32Decode("mzxw 6ytb oi").toString(), "foobar");
  const s = generateTotpSecret();
  assert.equal(s.length, 32, "160-bit secret = 32 base32 chars");
  assert.equal(base32Encode(base32Decode(s)), s);
  assert.equal(formatSecret("ABCDEFGHIJ"), "ABCD EFGH IJ");
  assert.throws(() => base32Decode("not!valid"));
});

test("verifyTotp: ±30 s drift, replay protection, format", () => {
  const s = generateTotpSecret();
  const now = Date.UTC(2026, 8, 26, 10, 0, 15);
  const current = totpAt(s, now);
  const r = verifyTotp(s, current, { now });
  assert.deepEqual(r, { ok: true, step: stepAt(now) });
  assert.equal(verifyTotp(s, totpAt(s, now - 30_000), { now }).ok, true, "previous step accepted");
  assert.equal(verifyTotp(s, totpAt(s, now + 30_000), { now }).ok, true, "next step accepted");
  assert.deepEqual(verifyTotp(s, totpAt(s, now - 90_000), { now }), { ok: false, reason: "invalid" }, "too old");
  assert.deepEqual(verifyTotp(s, current, { now, lastUsedStep: stepAt(now) }), { ok: false, reason: "replay" });
  assert.equal(verifyTotp(s, `${current.slice(0, 3)} ${current.slice(3)}`, { now }).ok, true, "spaces allowed");
  assert.deepEqual(verifyTotp(s, "12ab56", { now }), { ok: false, reason: "format" });
});

test("otpauth URL for authenticator apps", () => {
  const u = otpauthUrl({ secret: "JBSWY3DPEHPK3PXP", account: "mona@brookrege.com", issuer: "Brookrege" });
  assert.ok(u.startsWith("otpauth://totp/Brookrege%3Amona%40brookrege.com?"));
  const q = new URL(u).searchParams;
  assert.equal(q.get("secret"), "JBSWY3DPEHPK3PXP");
  assert.equal(q.get("issuer"), "Brookrege");
  assert.equal(q.get("period"), "30");
});

test("backup codes: 10 unique, readable, normalised", () => {
  const codes = generateBackupCodes();
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[a-z2-9]{4}-[a-z2-9]{4}$/);
  assert.ok(codes.every((c) => !/[01ilo]/.test(c)), "no look-alike characters");
  assert.equal(normalizeBackupCode("K7MQ 2XRF"), "k7mq-2xrf");
  assert.equal(normalizeBackupCode("k7mq2xrf"), "k7mq-2xrf");
  assert.equal(normalizeBackupCode("123456"), null, "a TOTP code isn't a backup code");
  assert.equal(normalizeBackupCode("k7mq-2xr0"), null);
});

test("IP allowlist: single addresses, ranges, IPv6, mapped IPv4", () => {
  const list = buildBlockList([{ value: "41.33.10.5" }, { value: "196.219.0.0/16" }, { value: "2c0f:fc88::/32" }]);
  assert.equal(ipAllowed("41.33.10.5", list), true);
  assert.equal(ipAllowed("::ffff:41.33.10.5", list), true, "IPv4-mapped IPv6 from Express");
  assert.equal(ipAllowed("41.33.10.6", list), false);
  assert.equal(ipAllowed("196.219.200.1", list), true);
  assert.equal(ipAllowed("196.220.0.1", list), false);
  assert.equal(ipAllowed("2c0f:fc88:1::7", list), true);
  assert.equal(ipAllowed("2001:db8::1", list), false);
  assert.equal(ipAllowed(undefined, list), false);
  assert.equal(ipAllowed("garbage", list), false);
  assert.equal(normalizeIp("fe80::1%eth0"), "fe80::1");
});

test("IP allowlist: invalid or too-wide entries are rejected on save", () => {
  assert.equal(parseEntry("41.33.10.0/24").ok, true);
  assert.equal(parseEntry("41.33.10.300").ok, false);
  assert.equal(parseEntry("41.33.10.0/33").ok, false);
  assert.equal(parseEntry("41.33.10.0/2x").ok, false);
  assert.equal(parseEntry("0.0.0.0/0").ok, false, "would allow everyone");
  assert.equal(parseEntry("::/0").ok, false);
  assert.equal(parseEntry("example.com").ok, false);
});

test("secret key rotation: data sealed with the old key still opens", () => {
  const OLD = "a".repeat(64), NEW = "b".repeat(64);
  const sealedOld = seal("SG.old-api-key", OLD);
  assert.equal(openWithAny(sealedOld, [NEW, OLD]), "SG.old-api-key");
  assert.equal(openWithAny(seal("x", NEW), [NEW, undefined]), "x");
  assert.throws(() => openWithAny(sealedOld, [NEW]));
  assert.throws(() => openWithAny(sealedOld, [undefined]), /No encryption key/);
});

test("reseal: moves secrets to the new key, skips ones already moved", async () => {
  const { reseal, open: openBox, seal: sealBox } = await import("../../src/lib/secretBox");
  const OLD = "1".repeat(64), NEW = "2".repeat(64);
  const moved = reseal(sealBox("totp-secret", OLD), NEW, [OLD])!;
  assert.equal(openBox(moved, NEW), "totp-secret");
  assert.equal(reseal(moved, NEW, [OLD]), null, "second run changes nothing");
  assert.throws(() => reseal(sealBox("x", "3".repeat(64)), NEW, [OLD]), "unknown key is an error, never silently dropped");
});

test("emails: visitor input and template text can't inject HTML; subjects can't inject headers", async () => {
  const { renderEmail } = await import("../../src/modules/notifications/renderEmail");
  const r = renderEmail(
    { subject: "New inquiry: {{title}}", body: "Name: {{name}}\n<img src=https://tracker.example/p.gif>", locale: "ar" },
    { name: '<script>alert(1)</script>"', title: "Villa\r\nBcc: attacker@example.com" },
  );
  assert.ok(!r.html.includes("<script>"), "visitor value escaped");
  assert.ok(r.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;&quot;"));
  assert.ok(!r.html.includes("<img"), "template text escaped too");
  assert.ok(r.html.includes('dir="rtl"'));
  assert.ok(!/[\r\n]/.test(r.subject), "no line breaks in the subject");
  assert.equal(r.text.split("\n")[0], 'Name: <script>alert(1)</script>"', "plain-text version is plain text");
});
