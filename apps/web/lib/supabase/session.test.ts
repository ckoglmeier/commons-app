import assert from "node:assert/strict";
import test from "node:test";
import {
  canonicalProductionUrl,
  commonsAuthCookieDomain,
  commonsAuthCookieMaxAge,
  getCommonsAuthCookieOptions,
} from "./session";

test("keeps production auth cookies across Commons hosts and browser restarts", () => {
  const options = getCommonsAuthCookieOptions("www.commons.travel");
  assert.equal(options.domain, commonsAuthCookieDomain);
  assert.equal(options.maxAge, commonsAuthCookieMaxAge);
  assert.equal(options.secure, true);
  assert.equal(options.sameSite, "lax");
});

test("does not attach the production cookie domain to previews or localhost", () => {
  assert.equal(getCommonsAuthCookieOptions("commons-web-git-branch.vercel.app").domain, undefined);
  assert.equal(getCommonsAuthCookieOptions("localhost").domain, undefined);
});

test("routes legacy production aliases to the canonical Commons host", () => {
  const source = new URL("https://commons-web-sigma.vercel.app/c/10000000-0000-4000-8000-000000000002?tab=money");
  const canonical = canonicalProductionUrl(source, "production");
  assert.equal(canonical?.toString(), "https://www.commons.travel/c/10000000-0000-4000-8000-000000000002?tab=money");
  assert.equal(canonicalProductionUrl(source, "preview"), null);
  assert.equal(canonicalProductionUrl(new URL("https://www.commons.travel/trips"), "production"), null);
});
