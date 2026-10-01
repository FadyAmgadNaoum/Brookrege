import { test } from "node:test";
import assert from "node:assert/strict";
import { can } from "../src/permissions";
import { formatEGP, formatEGPCompact, slugify } from "../src/format";

test("role matrix", () => {
  assert.equal(can("SUPER_ADMIN", "team:manage"), true);
  assert.equal(can("CONTENT_ADMIN", "team:manage"), false);
  assert.equal(can("CONTENT_ADMIN", "property:delete"), true);
  assert.equal(can("MODERATOR", "property:delete"), false);
  assert.equal(can("MODERATOR", "property:write"), false);
  assert.equal(can("MODERATOR", "property:lifecycle"), true);
  assert.equal(can("MODERATOR", "audit:read"), false);
});

test("EGP formatting", () => {
  assert.equal(formatEGP(2500000), "2,500,000 EGP");
  assert.equal(formatEGPCompact(2_500_000), "2.5M EGP");
  assert.equal(formatEGPCompact(3_000_000), "3M EGP");
  assert.equal(formatEGPCompact(1_250_000), "1.25M EGP");
  assert.equal(formatEGPCompact(850_000), "850K EGP");
});

test("slugify keeps Arabic, strips punctuation", () => {
  assert.equal(slugify("Retaj Compound – Phase 2!"), "retaj-compound-phase-2");
  assert.equal(slugify("  سدرة  "), "سدرة");
});
