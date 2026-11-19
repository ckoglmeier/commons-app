import assert from "node:assert/strict";
import test from "node:test";
import { closedBetaRequired, eventCreationDecision, hasBootstrapEventCreationAccess } from "./event-creation-policy";

test("creation defaults closed in production and hosted previews", () => {
  assert.equal(hasBootstrapEventCreationAccess({}, "production", "someone@example.test"), false);
  assert.equal(hasBootstrapEventCreationAccess({ VERCEL_ENV: "preview" }, "development", "someone@example.test"), false);
  assert.equal(hasBootstrapEventCreationAccess({}, "development"), true);
  assert.equal(hasBootstrapEventCreationAccess({ COMMONS_EVENT_ONBOARDING_ALLOWLIST: " Member@Example.test " }, "production", "member@example.test"), true);
  assert.equal(hasBootstrapEventCreationAccess({ COMMONS_EVENT_ONBOARDING_ALLOWLIST: "member@example.test" }, "production", "other@example.test"), false);
});

test("free beta lets any signed-in account with an email create, without an approval row", () => {
  assert.deepEqual(eventCreationDecision({ publicFreeBeta: true, accessStatus: null, hasClaimedEmail: true }), { allowed: true, status: "approved" });
  assert.deepEqual(eventCreationDecision({ publicFreeBeta: true, accessStatus: "requested", hasClaimedEmail: true }), { allowed: true, status: "approved" });
  assert.equal(eventCreationDecision({ publicFreeBeta: true, accessStatus: null, hasClaimedEmail: false }).allowed, false);
});

test("an explicit revocation still blocks during the free beta", () => {
  assert.deepEqual(eventCreationDecision({ publicFreeBeta: true, accessStatus: "revoked", hasClaimedEmail: true }), { allowed: false, status: "revoked" });
});

test("with the free beta off creation needs an approved row, exactly as before", () => {
  assert.equal(eventCreationDecision({ publicFreeBeta: false, accessStatus: null, hasClaimedEmail: true }).allowed, false);
  assert.deepEqual(eventCreationDecision({ publicFreeBeta: false, accessStatus: "requested", hasClaimedEmail: true }), { allowed: false, status: "requested" });
  assert.equal(eventCreationDecision({ publicFreeBeta: false, accessStatus: "approved", hasClaimedEmail: true }).allowed, true);
  assert.equal(eventCreationDecision({ publicFreeBeta: false, accessStatus: "revoked", hasClaimedEmail: true }).allowed, false);
});

test('marketing-only request gate overrides public free beta without revoking approved access',()=>{
 for(const status of [null,'requested','revoked'])assert.equal(eventCreationDecision({publicFreeBeta:true,requestOnly:true,accessStatus:status,hasClaimedEmail:true}).allowed,false);
 assert.equal(eventCreationDecision({publicFreeBeta:true,requestOnly:true,accessStatus:'approved',hasClaimedEmail:true}).allowed,true);
});


test('combined release defaults to approval even when old signup/payment switches are enabled', () => {
  for (const env of [{}, { COMMONS_PUBLIC_FREE_BETA_ENABLED: 'true' }, { COMMONS_BETA_REWORK_ENABLED: 'true' }]) {
    assert.equal(closedBetaRequired(env), true);
    for (const accessStatus of [null, 'requested', 'revoked']) assert.equal(eventCreationDecision({ publicFreeBeta: true, requestOnly: closedBetaRequired(env), accessStatus, hasClaimedEmail: true }).allowed, false);
    assert.equal(eventCreationDecision({ publicFreeBeta: true, requestOnly: closedBetaRequired(env), accessStatus: 'approved', hasClaimedEmail: true }).allowed, true);
  }
});
