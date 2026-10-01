import { test } from "node:test";
import assert from "node:assert/strict";
import { widthsFor, srcSet, pickVariant, mediaLifecycle } from "../src/media";
import { parseRange, previousRange, fillDailySeries, percentChange, conversionRate, median, eachDay } from "../src/analytics";
import { toCsv } from "../src/csv";
import { renderTemplate, templateVariables, smsSegments, toE164Egypt } from "../src/templates";
import { backoffMs, shouldRetry, nextReportRun } from "../src/jobs";
import { can } from "../src/permissions";

const D = (s: string) => new Date(s);

test("image widths never upscale", () => {
  assert.deepEqual(widthsFor(4000), [480, 960, 1600]);
  assert.deepEqual(widthsFor(1000), [480, 960]);
  assert.deepEqual(widthsFor(300), [480]); // tiny image still gets one (sharp won't enlarge)
});

test("srcset and variant picking", () => {
  const v = { "480": "a.webp", "960": "b.webp" };
  assert.equal(srcSet(v), "a.webp 480w, b.webp 960w");
  assert.equal(pickVariant(v, 700), "b.webp");
  assert.equal(pickVariant(v, 2000), "b.webp");
  assert.equal(srcSet(null), undefined);
});

test("media expiration strategy", () => {
  const now = D("2026-10-31T00:00:00Z");
  assert.equal(mediaLifecycle({ deletedAt: D("2026-10-20T00:00:00Z"), createdAt: D("2026-01-01"), usageCount: 0 }, now), "keep");
  assert.equal(mediaLifecycle({ deletedAt: D("2026-09-30T00:00:00Z"), createdAt: D("2026-01-01"), usageCount: 0 }, now), "purge");
  assert.equal(mediaLifecycle({ deletedAt: null, createdAt: D("2026-10-20T00:00:00Z"), usageCount: 0 }, now), "soft_delete");
  assert.equal(mediaLifecycle({ deletedAt: null, createdAt: D("2026-10-30T00:00:00Z"), usageCount: 0 }, now), "keep");
  assert.equal(mediaLifecycle({ deletedAt: null, createdAt: D("2025-01-01"), usageCount: 3 }, now), "keep");
});

test("date ranges", () => {
  const r = parseRange("2026-09-01", "2026-09-30");
  assert.equal(r.days, 30);
  assert.equal(r.to.toISOString(), "2026-09-30T23:59:59.999Z");
  const p = previousRange(r);
  assert.equal(p.from.toISOString(), "2026-08-02T00:00:00.000Z");
  assert.equal(p.days, 30);
  assert.equal(parseRange(undefined, undefined, D("2026-09-26T15:00:00Z")).days, 30);
  assert.throws(() => parseRange("2026-09-30", "2026-09-01"), RangeError);
  assert.throws(() => parseRange("2024-01-01", "2026-01-01"), RangeError);
  assert.throws(() => parseRange("nope", "2026-01-01"), RangeError);
  assert.equal(eachDay(parseRange("2026-02-27", "2026-03-01")).join(), "2026-02-27,2026-02-28,2026-03-01");
});

test("daily series fills gaps", () => {
  const r = parseRange("2026-09-01", "2026-09-03");
  assert.deepEqual(fillDailySeries(r, [{ day: "2026-09-02", value: 5 }]).map((x) => x.value), [0, 5, 0]);
});

test("KPI maths", () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(50, 100), -50);
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(0, 0), 0);
  assert.equal(conversionRate(3, 200), 1.5);
  assert.equal(conversionRate(3, 0), null);
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test("CSV: BOM, escaping, Arabic, injection guard", () => {
  const csv = toCsv([{ a: 'He said "hi", ok', b: "=HYPERLINK(\"x\")", c: "شقة ٣ غرف", n: -5 }], [
    { header: "A", value: (r) => r.a }, { header: "B", value: (r) => r.b }, { header: "C", value: (r) => r.c }, { header: "N", value: (r) => r.n },
  ]);
  assert.ok(csv.startsWith("\uFEFFA,B,C,N\r\n"));
  assert.ok(csv.includes('"He said ""hi"", ok"'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`), "formula neutralised");
  assert.ok(csv.includes("شقة ٣ غرف"));
  assert.ok(csv.trimEnd().endsWith(",-5"), "numbers are not treated as formulas");
});

test("templates render, escape and report missing variables", () => {
  const r = renderTemplate("مرحبًا {{name}}، بخصوص {{ title }} {{unknown}}", { name: "<b>Ali</b>", title: "شقة" }, { html: true });
  assert.equal(r.text, "مرحبًا &lt;b&gt;Ali&lt;/b&gt;، بخصوص شقة ");
  assert.deepEqual(r.missing, ["unknown"]);
  assert.deepEqual(templateVariables("{{a}} {{b}} {{a}}"), ["a", "b"]);
});

test("SMS segments and Egyptian numbers", () => {
  assert.deepEqual(smsSegments("Hello"), { encoding: "GSM-7", segments: 1 });
  assert.deepEqual(smsSegments("مرحبا".repeat(15)), { encoding: "UCS-2", segments: 2 });
  assert.equal(toE164Egypt("010 1234 5678"), "+201012345678");
  assert.equal(toE164Egypt("+201512345678"), "+201512345678");
  assert.equal(toE164Egypt("00201112345678"), "+201112345678");
  assert.equal(toE164Egypt("0223456789"), null, "landline rejected");
});

test("job retry policy and report schedule", () => {
  const fixed = () => 0.5;
  assert.equal(backoffMs(1, 30_000, 3_600_000, fixed), 30_000);
  assert.equal(backoffMs(3, 30_000, 3_600_000, fixed), 120_000);
  assert.equal(backoffMs(20, 30_000, 3_600_000, fixed), 3_600_000);
  assert.equal(shouldRetry(2, 5), true);
  assert.equal(shouldRetry(5, 5), false);
  // 2026-09-26 is a Saturday → next Sunday 27th 05:00 UTC
  assert.equal(nextReportRun("WEEKLY", D("2026-09-26T10:00:00Z")).toISOString(), "2026-09-27T05:00:00.000Z");
  assert.equal(nextReportRun("WEEKLY", D("2026-09-27T05:00:00Z")).toISOString(), "2026-10-04T05:00:00.000Z");
  assert.equal(nextReportRun("MONTHLY", D("2026-09-26T10:00:00Z")).toISOString(), "2026-10-01T05:00:00.000Z");
  assert.equal(nextReportRun("MONTHLY", D("2026-12-15T00:00:00Z")).toISOString(), "2027-01-01T05:00:00.000Z");
});

test("new permissions", () => {
  assert.equal(can("CONTENT_ADMIN", "media:write"), true);
  assert.equal(can("MODERATOR", "media:write"), false);
  assert.equal(can("CONTENT_ADMIN", "notifications:manage"), false);
  assert.equal(can("SUPER_ADMIN", "notifications:manage"), true);
});
