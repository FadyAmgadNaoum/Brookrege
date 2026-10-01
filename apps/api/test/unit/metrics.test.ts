import { test } from "node:test";
import assert from "node:assert/strict";
import { Registry, normalizeRoute, statusClass } from "../../src/lib/metrics";

test("counter, gauge and histogram render in Prometheus text format", async () => {
  const r = new Registry();
  const c = r.counter("http_requests_total", "Requests.", ["method", "route"]);
  c.inc({ method: "GET", route: "/api/properties" });
  c.inc({ method: "GET", route: "/api/properties" }, 2);
  const g = r.gauge("queue_depth", "Depth.");
  g.set(undefined, 7);
  const h = r.histogram("latency_seconds", "Latency.", ["route"], [0.1, 0.5, 1]);
  h.observe({ route: "/x" }, 0.05);
  h.observe({ route: "/x" }, 0.3);
  h.observe({ route: "/x" }, 5);
  const out = await r.render();
  assert.match(out, /# TYPE http_requests_total counter\nhttp_requests_total\{method="GET",route="\/api\/properties"\} 3/);
  assert.match(out, /queue_depth 7/);
  assert.match(out, /latency_seconds_bucket\{route="\/x",le="0.1"\} 1\n/);
  assert.match(out, /latency_seconds_bucket\{route="\/x",le="0.5"\} 2\n/);
  assert.match(out, /latency_seconds_bucket\{route="\/x",le="1"\} 2\n/);
  assert.match(out, /latency_seconds_bucket\{route="\/x",le="\+Inf"\} 3\n/);
  assert.match(out, /latency_seconds_sum\{route="\/x"\} 5.35/);
  assert.match(out, /latency_seconds_count\{route="\/x"\} 3/);
  assert.ok(out.endsWith("\n"));
});

test("label values are escaped; unknown labels and bad names are rejected", async () => {
  const r = new Registry();
  const c = r.counter("x_total", "X.", ["v"]);
  c.inc({ v: 'a"b\\c\nd' });
  assert.match(await r.render(), /x_total\{v="a\\"b\\\\c\\nd"\} 1/);
  assert.throws(() => c.inc({ nope: "1" } as never), /Unknown label/);
  assert.throws(() => r.counter("bad-name", "x"), /Invalid metric name/);
  assert.throws(() => r.histogram("h", "x", ["le"]), /Invalid label name/);
  assert.throws(() => c.inc(undefined, -1), /only go up/);
});

test("collectors run before each scrape and a failing one doesn't break the rest", async () => {
  const r = new Registry();
  let n = 0;
  r.gauge("scrapes", "Scrapes.", [], function () { n++; (r.get("scrapes") as import("../../src/lib/metrics").Gauge).set(undefined, n); });
  r.onCollect(() => { throw new Error("boom"); });
  assert.match(await r.render(), /scrapes 1/);
  assert.match(await r.render(), /scrapes 2/);
});

test("same name returns the same metric; type clash is an error", () => {
  const r = new Registry();
  assert.equal(r.counter("a_total", "A."), r.counter("a_total", "A."));
  assert.throws(() => r.gauge("a_total", "A."), /already registered/);
});

test("setTotal never goes down; startTimer records seconds", async () => {
  const r = new Registry();
  const c = r.counter("cpu_seconds_total", "CPU.");
  c.setTotal(undefined, 5); c.setTotal(undefined, 3);
  assert.equal(c.get(), 5);
  const h = r.histogram("t_seconds", "T.", ["k"], [1]);
  const stop = h.startTimer({ k: "a" });
  const s = stop();
  assert.ok(s >= 0 && s < 1);
  assert.match(await r.render(), /t_seconds_count\{k="a"\} 1/);
});

test("route and status labels stay low-cardinality", () => {
  assert.equal(normalizeRoute("/api", "/properties/:id"), "/api/properties/:id");
  assert.equal(normalizeRoute("/api/admin/team", "/"), "/api/admin/team");
  assert.equal(normalizeRoute("", undefined), "unmatched");
  assert.equal(statusClass(200), "2xx");
  assert.equal(statusClass(503), "5xx");
  assert.equal(statusClass(429), "429");
  assert.equal(statusClass(418), "4xx");
});
