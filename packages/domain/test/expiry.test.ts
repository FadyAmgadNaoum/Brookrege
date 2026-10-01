import { test } from "node:test";
import assert from "node:assert/strict";
import { addMonthsClamped, computeExpiry, daysUntilExpiry, isPubliclyVisible } from "../src/expiry";

const d = (s: string) => new Date(s);

test("adds 3 months on a normal date", () => {
  assert.equal(computeExpiry(d("2026-09-26T10:00:00Z")).toISOString(), "2026-12-26T10:00:00.000Z");
});

test("clamps month-end dates instead of rolling over", () => {
  assert.equal(addMonthsClamped(d("2026-11-30T00:00:00Z"), 3).toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(addMonthsClamped(d("2027-11-30T00:00:00Z"), 3).toISOString(), "2028-02-29T00:00:00.000Z");
  assert.equal(addMonthsClamped(d("2026-01-31T00:00:00Z"), 1).toISOString(), "2026-02-28T00:00:00.000Z");
});

test("crosses year boundary", () => {
  assert.equal(computeExpiry(d("2026-11-15T00:00:00Z")).toISOString(), "2027-02-15T00:00:00.000Z");
});

test("rejects invalid durations", () => {
  assert.throws(() => computeExpiry(new Date(), 0), RangeError);
  assert.throws(() => computeExpiry(new Date(), 1.5), RangeError);
  assert.throws(() => computeExpiry(new Date(), 25), RangeError);
});

test("public visibility", () => {
  const now = d("2026-10-01T00:00:00Z");
  const future = d("2026-12-01T00:00:00Z");
  const past = d("2026-09-01T00:00:00Z");
  assert.equal(isPubliclyVisible({ status: "ACTIVE", expiresAt: future, deletedAt: null }, now), true);
  assert.equal(isPubliclyVisible({ status: "ACTIVE", expiresAt: past, deletedAt: null }, now), false, "expired by date even if status not yet flipped");
  assert.equal(isPubliclyVisible({ status: "EXPIRED", expiresAt: future, deletedAt: null }, now), false);
  assert.equal(isPubliclyVisible({ status: "DRAFT", expiresAt: future, deletedAt: null }, now), false);
  assert.equal(isPubliclyVisible({ status: "ACTIVE", expiresAt: future, deletedAt: now }, now), false);
  assert.equal(isPubliclyVisible({ status: "ACTIVE", expiresAt: null, deletedAt: null }, now), false);
});

test("days until expiry", () => {
  const now = d("2026-10-01T00:00:00Z");
  assert.equal(daysUntilExpiry(d("2026-10-11T00:00:00Z"), now), 10);
  assert.equal(daysUntilExpiry(null, now), null);
});
