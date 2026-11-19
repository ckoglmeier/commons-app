import assert from "node:assert/strict";
import test from "node:test";
import { canonicalProductionUrl, commonsAuthCookieMaxAge, getCommonsAuthCookieOptions } from "./session";

test("sign-in cookies are host-only by default, so any copy's address works", () => {
  for (const host of ["trips.example.com", "my-commons.vercel.app", "localhost"]) {
    const options = getCommonsAuthCookieOptions(host, {});
    assert.equal(options.domain, undefined, host);
    assert.equal(options.maxAge, commonsAuthCookieMaxAge);
    assert.equal(options.sameSite, "lax");
  }
});

test("a configured cookie domain is shared across that domain only", () => {
  const env = { COMMONS_AUTH_COOKIE_DOMAIN: ".example.com" };
  assert.equal(getCommonsAuthCookieOptions("trips.example.com", env).domain, ".example.com");
  assert.equal(getCommonsAuthCookieOptions("example.com", env).domain, ".example.com");
  assert.equal(getCommonsAuthCookieOptions("my-commons.vercel.app", env).domain, undefined);
  assert.equal(getCommonsAuthCookieOptions("evil-example.com", env).domain, undefined);
});

test("the vercel.app address moves to the copy's own domain only when one is configured", () => {
  const source = new URL("https://my-commons.vercel.app/c/10000000-0000-4000-8000-000000000002?tab=money");
  assert.equal(canonicalProductionUrl(source, "production", "https://trips.example.com")?.toString(), "https://trips.example.com/c/10000000-0000-4000-8000-000000000002?tab=money");
  assert.equal(canonicalProductionUrl(source, "production", undefined), null, "no own domain: stay on vercel.app");
  assert.equal(canonicalProductionUrl(source, "production", "https://my-commons.vercel.app"), null);
  assert.equal(canonicalProductionUrl(source, "preview", "https://trips.example.com"), null);
  assert.equal(canonicalProductionUrl(new URL("https://trips.example.com/trips"), "production", "https://trips.example.com"), null);
});
