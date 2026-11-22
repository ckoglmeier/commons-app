import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Password sign-in: the typed address proves nothing. Every way the web layer hands an account to the database says so, and nothing
// shown or granted in the web layer is found by that address. Behaviour is tested against the database in
// packages/database/src/password-identity.integration.test.ts; this guards the wiring that reaches it.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("both account readers say whether the email proves identity, from this copy's sign-in method", () => {
  const server = read("./supabase/server.ts");
  assert.match(server, /return \(await currentSignInMethod\(\)\) !== "password";/);
  assert.equal(server.match(/emailProvesIdentity: await signInEmailProvesIdentity\(\)/g)?.length, 2, "getCommonsAuthIdentity and getVerifiedAuthUser");
});

test("invitations are never found by a password account's address, and accepting carries the flag", () => {
  const commons = read("./server/commons.ts");
  assert.match(commons, /if \(!identity\?\.email \|\| identity\.emailProvesIdentity === false\) return \[\];\n {2}return listPendingCommonsInvitationsForIdentity/);
  assert.match(commons, /emailProvesIdentity: verified\.emailProvesIdentity !== false && identity\.emailProvesIdentity !== false,/);
  const polls = read("./server/polls.ts");
  assert.match(polls, /export async function pendingPollInvitation\(publicId: string\) \{\n.*\n {2}if \(await currentSignInMethod\(\) === "password"\) return null;/);
});

test("group links pass the flag through, so joining never claims an invited person by address", () => {
  assert.match(read("./server/group-invitations.ts"), /emailProvesIdentity: user\.emailProvesIdentity \}/);
  assert.match(read("../../../packages/database/src/group-invitation-repository.ts"), /displayName: identity\.displayName, emailProvesIdentity: identity\.emailProvesIdentity \}, databaseUrl\)/);
});

test("on a password copy whoever holds the private link is offered the invitation", () => {
  const page = read("../app/join/[token]/page.tsx");
  assert.match(page, /const passwordSignIn = isSupabaseAuthConfigured\(\) && await currentSignInMethod\(\) === "password";/);
  assert.match(page, /const sameAccount = identity && \(passwordSignIn \|\|/);
});

test("a password account's address never makes it a poll's response-only guest, and the editor doesn't offer guest emails", () => {
  assert.match(read("./server/polls.ts"), /email: verified\.emailProvesIdentity === false \? null : verified\.email/);
  assert.match(read("../app/c/[slug]/polls/new/page.tsx"), /guestEmailsAllowed=\{await currentSignInMethod\(\) !== "password"\}/);
  assert.match(read("../app/c/[slug]/polls/new/poll-starter.tsx"), /guestEmails: guestEmailsAllowed \? /);
});

test("every server path that resolves a signed-in account's person meets Who can join first", () => {
  for (const path of ["./server/commons.ts", "./server/event-creation.ts", "./server/polls.ts", "./server/profile.ts", "./server/group-invitations.ts"]) {
    const source = read(path);
    assert.doesNotMatch(source, /findOrClaimPersonForAuthIdentity/, `${path} must go through personForSignedInAccount`);
    assert.match(source, /(personForSignedInAccount|signedInPersonOrRefusal)\(/, path);
  }
  const gate = read("./server/account-person.ts");
  assert.match(gate, /findOrClaimPersonForAuthIdentity\(identity, databaseUrl, \{ allowNewPerson: decision\.allowed \}\)/);
  const create = read("../app/account/create/actions.ts");
  assert.doesNotMatch(create, /findOrClaimPersonForAuthIdentity/);
  assert.equal(create.match(/placeSignedInAccount\(/g)?.length, 2, "test sign-in and Supabase paths");
  assert.match(read("../app/sign-in/actions.ts"), /if \(!known && mode === "sign-in"\) \{/);
});
