import { test } from "node:test";
import assert from "node:assert/strict";
import { mask, open, seal } from "../../src/lib/secretBox";

const KEY = "a".repeat(64);

test("round-trips, including Arabic", () => {
  const s = seal("SG.secret-key-مفتاح", KEY);
  assert.match(s, /^v1:/);
  assert.equal(open(s, KEY), "SG.secret-key-مفتاح");
});
test("each seal is different (random IV)", () => assert.notEqual(seal("x", KEY), seal("x", KEY)));
test("wrong key is rejected", () => assert.throws(() => open(seal("x", KEY), "b".repeat(64))));
test("tampering is detected", () => {
  const parts = seal("hello", KEY).split(":");
  const data = Buffer.from(parts[3]!, "base64"); data[0]! ^= 1; parts[3] = data.toString("base64");
  assert.throws(() => open(parts.join(":"), KEY));
});
test("bad key length", () => assert.throws(() => seal("x", "abcd")));
test("mask", () => assert.equal(mask("SG.1234567890abcd"), "••••••••abcd"));
