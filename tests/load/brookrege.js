// Load test for Brookrege (k6 — https://k6.io). Simulates visitors browsing the public site.
//
//   k6 run -e BASE_URL=https://staging.brookrege.com -e PROFILE=smoke tests/load/brookrege.js
//   PROFILE: smoke (5 users, 1 min) · 1k · 5k · 10k (ramping to that many simultaneous visitors)
//
// Read docs/operations/PERFORMANCE.md › "Load testing" first: run against STAGING, from an address listed in
// loadtest-allow.conf, with a Cloudflare skip rule for it — otherwise you are testing the rate limits.
// WRITE=1 also submits inquiries (staging only: they create real leads and messages).
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://localhost:8080").replace(/\/$/, "");
const PROFILE = __ENV.PROFILE || "smoke";
const WRITE = __ENV.WRITE === "1";
const LOCALES = ["ar", "ar", "ar", "en"]; // most visitors use Arabic

const apiTime = new Trend("api_duration", true);
const pageTime = new Trend("page_duration", true);

const ramp = (target) => ({
  executor: "ramping-vus",
  startVUs: 0,
  stages: [
    { duration: "2m", target: Math.round(target / 4) },
    { duration: "3m", target },          // ramp to the full number of simultaneous visitors
    { duration: "5m", target },          // hold
    { duration: "2m", target: 0 },
  ],
  gracefulRampDown: "30s",
});

const PROFILES = {
  smoke: { executor: "constant-vus", vus: 5, duration: "1m" },
  "1k": ramp(1000),
  "5k": ramp(5000),
  "10k": ramp(10000),
};

export const options = {
  scenarios: { visitors: PROFILES[PROFILE] || PROFILES.smoke },
  thresholds: {
    // Roadmap targets: API p95 < 500 ms; fewer than 1% failed requests.
    "api_duration": ["p(95)<500"],
    "http_req_failed": ["rate<0.01"],
    "page_duration": ["p(95)<1500"],
    "checks": ["rate>0.99"],
  },
  userAgent: "Mozilla/5.0 (Linux; Android 14) BrookregeLoadTest/1.0",
  discardResponseBodies: false,
  insecureSkipTLSVerify: __ENV.INSECURE === "1",
};

export function setup() {
  const res = http.get(`${BASE}/api/properties?pageSize=48`);
  let ids = [];
  try { ids = (res.json("data") || []).map((p) => p.id).filter(Boolean); } catch (_) { /* not JSON */ }
  let regions = [];
  try { regions = (http.get(`${BASE}/api/regions`).json("data") || []).map((r) => r.slug); } catch (_) { /* ignore */ }
  return { ids, regions };
}

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const think = (min, max) => sleep(min + Math.random() * (max - min)); // real visitors read between clicks

function page(path) {
  const r = http.get(`${BASE}${path}`, { tags: { kind: "page" } });
  pageTime.add(r.timings.duration);
  check(r, { "page 200": (x) => x.status === 200 });
  return r;
}
function api(path) {
  const r = http.get(`${BASE}/api${path}`, { tags: { kind: "api" } });
  apiTime.add(r.timings.duration);
  check(r, { "api 200": (x) => x.status === 200 });
  return r;
}

export default function (data) {
  const loc = pick(LOCALES);
  group("home", () => { page(`/${loc}`); api("/properties/summary"); });
  think(2, 6);

  group("search", () => {
    const type = pick(["APARTMENT", "VILLA", "SHOP", "LAND", ""]);
    const tx = pick(["SALE", "SALE", "RENT"]);
    const region = data.regions.length && Math.random() < 0.4 ? `&region=${pick(data.regions)}` : "";
    const qs = `transaction=${tx}${type ? `&type=${type}` : ""}${region}`;
    page(`/${loc}/properties?${qs}`);
    api(`/properties?${qs}`);
    if (Math.random() < 0.3) api(`/properties?${qs}&page=2`);
  });
  think(3, 8);

  if (data.ids.length) {
    group("listing", () => {
      const id = pick(data.ids);
      page(`/${loc}/properties/${id}`);
      api(`/properties/${id}`);
      http.post(`${BASE}/api/properties/${id}/view`, null, { tags: { kind: "beacon" } });
    });
    think(5, 15);
    if (WRITE && Math.random() < 0.02) {
      group("inquiry", () => {
        const r = http.post(`${BASE}/api/inquiries`, JSON.stringify({ propertyId: pick(data.ids), name: "Load Test", phone: "01000000000", message: "k6 load test — ignore" }), { headers: { "Content-Type": "application/json" }, tags: { kind: "form" } });
        check(r, { "inquiry accepted or rate-limited": (x) => x.status === 201 || x.status === 429 });
      });
    }
  }

  if (Math.random() < 0.15) { group("map", () => { page(`/${loc}/map`); api("/properties/map"); }); think(5, 10); }
  if (Math.random() < 0.1) { group("compounds", () => { page(`/${loc}/compounds`); api("/compounds"); }); think(3, 8); }
}
