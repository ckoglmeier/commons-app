import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, memberships, people } from "./schema";
import { addCommonsPerson, findOrClaimPersonForAuthIdentity } from "./onboarding-repository";

// Who can join (C18) is decided in the web layer. When it refuses an account, the database must never make that account a new person,
// whichever page it reached first. A person the account's proven email already names can still be claimed.
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

test("a refused account gets no new person", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const db = createDatabase(url), authUserId = randomUUID();
  try {
    const personId = await findOrClaimPersonForAuthIdentity({ authUserId, email: `stranger-${authUserId}@example.com`, displayName: "Stranger" }, url, { allowNewPerson: false });
    assert.equal(personId, null);
    assert.equal((await db.db.select().from(people).where(eq(people.authUserId, authUserId))).length, 0);
  } finally { await db.close(); }
});

test("a refused account still claims the person its proven email was invited as", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  const db = createDatabase(url), owner = randomUUID(), trip = randomUUID(), authUserId = randomUUID(), email = `invited-${authUserId}@example.com`;
  try {
    await db.db.insert(people).values({ id: owner, displayName: "Organizer", authUserId: randomUUID() });
    await db.db.insert(commons).values({ id: trip, slug: trip, name: "Join rule test", createdByPersonId: owner, timezone: "America/Denver" });
    await db.db.insert(memberships).values({ commonsId: trip, personId: owner, role: "organizer", status: "active" });
    await addCommonsPerson(trip, { displayName: "Maya", email, role: "member" }, { databaseUrl: url, actorPersonId: owner });
    const personId = await findOrClaimPersonForAuthIdentity({ authUserId, email, displayName: "Maya" }, url, { allowNewPerson: false });
    assert.ok(personId);
    const [person] = await db.db.select().from(people).where(eq(people.id, personId!));
    assert.equal(person!.authUserId, authUserId);
  } finally { await db.close(); }
});
