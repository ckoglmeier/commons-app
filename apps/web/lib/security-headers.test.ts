import assert from "node:assert/strict";
import test from "node:test";
import nextConfig from "../next.config";

test("every response receives the baseline browser security headers", async () => {
  assert.equal(typeof nextConfig.headers, "function");
  const rules = await nextConfig.headers!();
  const globalRule = rules.find((rule) => rule.source === "/(.*)");
  assert.ok(globalRule);
  const headers = new Map(globalRule.headers.map((header) => [header.key, header.value]));

  assert.match(headers.get("Content-Security-Policy") ?? "", /frame-ancestors 'none'/);
  assert.match(headers.get("Content-Security-Policy") ?? "", /object-src 'none'/);
  assert.equal(headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(headers.get("Referrer-Policy"), "strict-origin-when-cross-origin");
});
