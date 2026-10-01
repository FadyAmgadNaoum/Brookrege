import { test } from "node:test";
import assert from "node:assert/strict";
import { buildBlockList, ipAllowed, normalizeIp, parseEntry } from "../../src/lib/ipAllowlist";
import { openWithAny, seal } from "../../src/lib/secretBox";

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
  const moved = reseal(sealBox("provider-api-key", OLD), NEW, [OLD])!;
  assert.equal(openBox(moved, NEW), "provider-api-key");
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
