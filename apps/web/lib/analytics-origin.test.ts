import assert from "node:assert/strict";
import test from "node:test";
import { analyticsOriginAllowed as allowed } from "./analytics-origin";
test("analytics accepts its public origin behind an internal reverse proxy", () => {
  assert.equal(allowed("http://127.0.0.1:4341", "http://localhost:4341/api", "http://127.0.0.1:4341"), true);
  assert.equal(allowed("https://commons.example", "http://internal:3000/api", "https://commons.example"), true);
  assert.equal(allowed("https://commons.example", "https://commons.example/api"), true);
  assert.equal(allowed(null, "https://commons.example/api"), true);
});
test("analytics rejects foreign, malformed, downgraded and wrong-port origins", () => {
  for (const origin of ["https://evil.example", "https://commons.example.evil.example", "null", "bad", "http://commons.example", "https://commons.example:444", "https://commons.example/path"]) {
    assert.equal(allowed(origin, "https://commons.example/api", "https://commons.example"), false, origin);
  }
});
