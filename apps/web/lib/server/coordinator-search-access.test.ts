import test from "node:test";
import assert from "node:assert/strict";
import {registerComponentImportStubs} from "../test-support/hook-harness";
registerComponentImportStubs();
test("search email gate uses authenticated identity and fails closed",async()=>{
 const {searchIdentityAllowed,canUseCoordinatorSearch}=await import("./coordinator-search-access");
 const owner="qa-owner@example.com";
 assert.equal(searchIdentityAllowed({authUserId:"verified-subject",email:" QA-OWNER@EXAMPLE.COM "},owner),true);
 for(const identity of [null,{authUserId:"subject"},{authUserId:"subject",email:"other@example.com"},{authUserId:"",email:owner}])assert.equal(searchIdentityAllowed(identity,owner),false);
 assert.equal(searchIdentityAllowed({authUserId:"subject",email:owner},""),false);
 assert.equal(await canUseCoordinatorSearch(),false,"pilot identity alone does not establish signed-in email");
});


test("search session requires provider-confirmed email for the same signed-in subject",async()=>{
 const {verifiedSearchAccount}=await import("./coordinator-search-session");const identity={authUserId:"one",email:"qa@example.com"},user={id:"one",email:"qa@example.com",email_confirmed_at:"2026-10-07T00:00:00Z"};
 assert.deepEqual(verifiedSearchAccount(identity,user,null),identity);assert.equal(verifiedSearchAccount(identity,{...user,id:"two"},null),null);assert.equal(verifiedSearchAccount(identity,{...user,email_confirmed_at:null},null),null);assert.equal(verifiedSearchAccount(identity,user,new Error("auth failed")),null);assert.equal(verifiedSearchAccount(null,user,null),null);
});

test("global beta admits provider-verified non-owner identities and flag-off restores owner-only access",async()=>{
 const {betaSearchIdentityAllowed}=await import("./coordinator-search-access");
 const identity={authUserId:"verified-subject",email:"another-beta@example.invalid"};
 assert.equal(betaSearchIdentityAllowed(identity,true),true);
 assert.equal(betaSearchIdentityAllowed(identity,false),false);
 for(const invalid of [null,{authUserId:"subject"},{authUserId:"",email:"a@example.com"},{authUserId:"subject",email:"  "}]) assert.equal(betaSearchIdentityAllowed(invalid,true),false);
});

test("all-user synchronous beta never widens the separately gated background worker",async()=>{
 const {searchIdentityAllowed,betaSearchIdentityAllowed}=await import("./coordinator-search-access");
 const account={authUserId:"verified-beta-subject",email:"beta@example.invalid"};
 assert.equal(betaSearchIdentityAllowed(account,true),true);assert.equal(searchIdentityAllowed(account),false);
});
