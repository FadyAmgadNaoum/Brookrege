import { test } from "node:test";
import assert from "node:assert/strict";
// @ts-expect-error — plain .mjs module without type declarations
import { securityHeaders } from "../securityHeaders.mjs";

const csp = (o: object) => (securityHeaders(o) as { key: string; value: string }[]).find((h) => h.key === "Content-Security-Policy")!.value;

test("production admin (same-origin API): strict framing, HTTPS upgrade, no eval", () => {
  const v = csp({ apiUrl: "" });
  assert.match(v, /frame-ancestors 'none'/);
  assert.match(v, /object-src 'none'/);
  assert.match(v, /upgrade-insecure-requests/);
  assert.doesNotMatch(v, /unsafe-eval/);
  assert.match(v, /connect-src 'self'(;|$)/, "no other origins can be called");
});

test("public site with an API origin: allowed for data, images and video", () => {
  const v = csp({ apiUrl: "https://brookrege.com/api", allowFraming: true });
  assert.match(v, /connect-src 'self' https:\/\/brookrege\.com/);
  assert.match(v, /img-src [^;]*https:\/\/brookrege\.com/);
  assert.match(v, /frame-ancestors 'self'/);
});

test("local development over http: no HTTPS upgrade (it would break localhost), eval + websockets for hot reload", () => {
  const v = csp({ apiUrl: "http://localhost:4000", dev: true });
  assert.doesNotMatch(v, /upgrade-insecure-requests/);
  assert.match(v, /'unsafe-eval'/);
  assert.match(v, /connect-src 'self' http:\/\/localhost:4000 ws:/);
  const local = csp({ apiUrl: "http://localhost:4000" });
  assert.doesNotMatch(local, /upgrade-insecure-requests/, "a production build served over http (local Docker) isn't upgraded");
});

test("bad API URL doesn't break the headers", () => assert.match(csp({ apiUrl: "not a url" }), /default-src 'self'/));
