import assert from "node:assert/strict";
import test from "node:test";
import { chooseSignInMethod } from "./sign-in-method";

test("sign-in uses email links when email is set up, passwords when it isn't", () => {
  assert.equal(chooseSignInMethod({ supabase: true, email: true, localTest: false }), "link");
  assert.equal(chooseSignInMethod({ supabase: true, email: false, localTest: false }), "password");
});

test("without Supabase, only the local test sign-in or nothing", () => {
  assert.equal(chooseSignInMethod({ supabase: false, email: true, localTest: true }), "test");
  assert.equal(chooseSignInMethod({ supabase: false, email: true, localTest: false }), "off");
  assert.equal(chooseSignInMethod({ supabase: false, email: false, localTest: false }), "off");
});
