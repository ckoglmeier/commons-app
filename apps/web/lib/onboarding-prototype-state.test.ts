import assert from "node:assert/strict";
import test from "node:test";
import {
  onboardingPrototypeQuery,
  onboardingPrototypeStates,
  parseOnboardingPrototypeState,
} from "./onboarding-prototype-state";

test("every review state has a unique durable URL and test contract", () => {
  const ids = new Set(onboardingPrototypeStates.map((state) => state.id));
  const urls = new Set(onboardingPrototypeStates.map(onboardingPrototypeQuery));
  assert.equal(ids.size, onboardingPrototypeStates.length);
  assert.equal(urls.size, onboardingPrototypeStates.length);
  for (const state of onboardingPrototypeStates) {
    assert.ok(state.heading.length > 0);
    assert.ok(state.primaryAction.length > 0);
  }
});

test("review catalog covers phone, email, invitation, referral, and returning paths", () => {
  assert.ok(onboardingPrototypeStates.some((state) => state.scenario === "signup" && state.mode === "phone"));
  assert.ok(onboardingPrototypeStates.some((state) => state.scenario === "signup" && state.mode === "email"));
  assert.ok(onboardingPrototypeStates.some((state) => state.scenario === "referral" && state.mode === "email"));
  assert.ok(onboardingPrototypeStates.some((state) => state.scenario === "invitee" && state.primaryAction === "View the trip"));
  assert.ok(onboardingPrototypeStates.some((state) => state.scenario === "returning" && state.primaryAction === "View the trip"));
});

test("query parsing rejects unknown scenarios and clamps out-of-range steps", () => {
  assert.deepEqual(parseOnboardingPrototypeState({ scenario: "unknown", step: "99", mode: "email" }), {
    scenario: "signup",
    step: 2,
    mode: "phone",
  });
  assert.deepEqual(parseOnboardingPrototypeState({ scenario: "invitee", step: "-5" }), {
    scenario: "invitee",
    step: 0,
    mode: "phone",
  });
});

test("email mode is only available on an identity step", () => {
  assert.deepEqual(parseOnboardingPrototypeState({ scenario: "invitee", step: "1", mode: "email" }), {
    scenario: "invitee",
    step: 1,
    mode: "email",
  });
  assert.deepEqual(parseOnboardingPrototypeState({ scenario: "returning", step: "0", mode: "email" }), {
    scenario: "returning",
    step: 0,
    mode: "phone",
  });
});
