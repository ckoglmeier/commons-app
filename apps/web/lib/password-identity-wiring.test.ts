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
