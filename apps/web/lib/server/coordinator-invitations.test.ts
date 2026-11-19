import test from "node:test";
import assert from "node:assert/strict";
import {parseOrganizerInvites} from "@commons/contracts";

test("explicit invitation lists accept delimiters and names, deduplicate and normalize",()=>{
  for (const prefix of ["Invite", "Please invite", "Can you please invite", "I'd like to invite", "Send invitations to", "Invite these email addresses:"]) {
    const parsed=parseOrganizerInvites(`${prefix} Alice <ALICE@example.com>, bob@example.com; alice@example.com\ncarol@example.com`);
    assert.equal(parsed?.error,null,prefix);
    assert.deepEqual(parsed?.recipients.map(item=>item.email),["alice@example.com","bob@example.com","carol@example.com"]);
    assert.equal(parsed?.recipients[0].displayName,"Alice");
  }
  assert.equal(parseOrganizerInvites("Invite alice@example.com and bob@example.com to this trip")?.recipients.length,2);
  assert.equal(parseOrganizerInvites("Please invite Preview Alex <preview.alex@example.com>")?.recipients[0]?.displayName,"Preview Alex");
  assert.equal(parseOrganizerInvites("Here are the emails: alice@example.com, bob@example.com. Please invite them.")?.recipients.length,2);
});
test("invalid, mixed, deferred, and elevated-access requests never produce a partial list",()=>{
  for(const text of ["Invite alice@example.com, broken@", "Invite alice@example.com as an organizer", "Invite alice@example.com tomorrow", "Invite alice@example.com but not bob@example.com", "Invite: , ;",`Invite ${Array.from({length:25},(_,i)=>`p${i}@example.com`).join(",")}`]){
    const parsed=parseOrganizerInvites(text);assert.ok(parsed?.error,text);assert.deepEqual(parsed.recipients,[],text);
  }
});
test("quoted instructions, hypothetical requests and unrequested lists have no authority",()=>{
  for(const text of ["Someone said invite a@example.com",'"Invite a@example.com"',"Should we invite a@example.com?","Don't invite a@example.com","a@example.com, b@example.com","invite@example.com","invite-test@example.com","Here is a document: invite a@example.com"]){assert.equal(parseOrganizerInvites(text),null,text);}
  assert.ok(parseOrganizerInvites("Invite them")?.error);
  assert.equal(parseOrganizerInvites("a@example.com, b@example.com",true)?.recipients.length,2);
  assert.equal(parseOrganizerInvites("What are our trip dates?",true),null);
});


test("words inside email local parts are never interpreted as commands, labels or role requests",()=>{
  const addresses=["invite@example.com","invite-test@example.com","peoplealice@example.com","them@example.com","thesebob@example.com","organizer@example.com","tomorrow@example.com"];
  for(const email of addresses){assert.equal(parseOrganizerInvites(email),null,email);assert.equal(parseOrganizerInvites(`Invite ${email}`)?.recipients[0]?.email,email);}
});
