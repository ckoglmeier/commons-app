import assert from "node:assert/strict";
import test from "node:test";
import { betaInviteErrorMessage } from "./beta-invite-error";
import { EmailDeliveryError } from "./resend";

test("expired operator session gives sign-in recovery rather than delivery advice", () => {
  const error = new Error("Operator access is required.");
  error.name = "CommonsOperatorRequiredError";
  assert.match(betaInviteErrorMessage(error), /Sign in with your operator account/);
});

test("rate limiting is distinct from rejection and input validation remains actionable", () => {
  assert.match(betaInviteErrorMessage(new EmailDeliveryError("provider_rate_limited", "private provider response")), /sending quota/);
  assert.equal(betaInviteErrorMessage(new Error("Keep the message to 2,000 characters.")), "Keep the message to 2,000 characters.");
  assert.doesNotMatch(betaInviteErrorMessage(new EmailDeliveryError("provider_rejected", "private provider response")), /private provider response/);
});
