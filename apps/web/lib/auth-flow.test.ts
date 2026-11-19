import assert from "node:assert/strict";
import test from "node:test";
import { accountCreationPath, hasCompletedAccountName, safeAuthNext } from "./auth-flow";

test("keeps authentication redirects on Commons", () => {
  assert.equal(safeAuthNext("/join/private-token"), "/join/private-token");
  assert.equal(safeAuthNext("//example.com"), "/");
  assert.equal(safeAuthNext("https://example.com"), "/");
});

test("refuses every spelling a browser would read as another site", () => {
  const leaving = [
    "/\\evil.example", "\\\\evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\\/evil.example",
    "/./\\evil.example", "/.//evil.example", "/foo/..//evil.example", "/foo/../\\evil.example",
    "/%2F/evil.example", "/%2f/evil.example", "/%5Cevil.example", "/%5cevil.example",
    "/%E0%A4%A", "javascript:alert(1)", "evil.example", "", null, undefined,
  ];
  for (const next of leaving) assert.equal(safeAuthNext(next), "/", JSON.stringify(next));
  // Each one that resolves in a browser would really have left, which is why the old prefix check wasn't enough.
  assert.equal(new URL("/\\evil.example", "https://commons.test").host, "evil.example");
  assert.equal(new URL("/\t/evil.example", "https://commons.test").host, "evil.example");
});

test("leaves ordinary paths exactly as they were", () => {
  for (const next of [
    "/", "/c/trip-slug/?arrival=0", "/join/private-token", "/new?source=template&template=coast&draft=11111111-1111-4111-8111-111111111111",
    "/poll/abc?next=%2F%2Fnot-a-redirect", "/c/trip//double-slash-inside", "/search?q=https://example.com", "/c/a%20b",
  ]) assert.equal(safeAuthNext(next), next);
});

test("account creation can't carry a path that leaves Commons", () => {
  assert.equal(accountCreationPath("/\\evil.example", "invited"), "/account/create?next=%2F&intent=invited");
});

test("asks for a name only when account creation is incomplete", () => {
  assert.equal(hasCompletedAccountName({ first_name: "Robin" }), true);
  assert.equal(hasCompletedAccountName({ first_name: "  " }), false);
  assert.equal(hasCompletedAccountName({}), false);
});

test("preserves an invitation through account creation", () => {
  assert.equal(
    accountCreationPath("/join/private-token", "invited"),
    "/account/create?next=%2Fjoin%2Fprivate-token&intent=invited",
  );
});
