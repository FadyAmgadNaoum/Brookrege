import { test } from "node:test";
import assert from "node:assert/strict";
import { safeNext } from "../lib/safeNext";

test("only same-site paths are allowed after sign-in", () => {
  assert.equal(safeNext("/properties/abc?tab=photos"), "/properties/abc?tab=photos");
  assert.equal(safeNext("/"), "/");
  for (const bad of [null, "", "https://evil.com", "//evil.com", "/\\evil.com", "/\\/evil.com", "\\\\evil.com", "javascript:alert(1)", "/ok\n//evil", "/%0a", " /x"]) {
    const r = safeNext(bad);
    assert.ok(r === "/" || (bad === "/%0a" && r === "/%0a"), `${JSON.stringify(bad)} → ${r}`);
  }
  assert.equal(safeNext("/path\\with-backslash"), "/", "backslashes anywhere are refused");
});
