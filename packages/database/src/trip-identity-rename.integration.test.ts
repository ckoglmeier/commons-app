import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { resolveCommonsTripId } from "./commons-identifier";
import { getCommonsSnapshot, updateCommonsDetails } from "./pilot-repository";
import { commons, memberships, people } from "./schema";

test("renaming a trip preserves UUID and legacy URL resolution without widening membership", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(databaseUrl).hostname, "127.0.0.1");
  assert.ok(new URL(databaseUrl).pathname.endsWith("_test"));
  const db = createDatabase(databaseUrl);
  const trip = randomUUID(), owner = randomUUID(), member = randomUUID(), outsider = randomUUID();
  const slug = `rename-regression-${trip}`;
  const options = (actorPersonId: string) => ({ databaseUrl, actorPersonId });
  try {
    await db.db.insert(people).values([owner, member, outsider].map(id => ({ id, displayName: "Synthetic identity test" })));
    await db.db.insert(commons).values({ id: trip, slug, name: "Before rename", timezone: "America/Denver", createdByPersonId: owner });
    await db.db.insert(memberships).values([{ commonsId: trip, personId: owner, role: "organizer", status: "active" }, { commonsId: trip, personId: member, role: "member", status: "active" }]);
    const before = await getCommonsSnapshot(trip, options(owner));
    assert.equal(before?.commons.id, trip);
    await updateCommonsDetails(slug, { commandId: randomUUID(), title: "Entirely different title", startsOn: null, endsOn: null, locationName: null, locationNames: [], balancesDisabled: false }, options(owner));
    for (const identifier of [trip, slug]) {
      assert.equal(await resolveCommonsTripId(identifier, databaseUrl), trip);
      for (const actor of [owner, member]) {
        const snapshot = await getCommonsSnapshot(identifier, options(actor));
        assert.equal(snapshot?.commons.id, trip);
        assert.equal(snapshot?.commons.slug, slug);
        assert.equal(snapshot?.commons.name, "Entirely different title");
      }
      await assert.rejects(getCommonsSnapshot(identifier, options(outsider)));
    }
    await db.db.update(memberships).set({ status: "removed" }).where(eq(memberships.personId, member));
    await assert.rejects(getCommonsSnapshot(trip, options(member)));
  } finally {
    await db.db.delete(commons).where(eq(commons.id, trip));
    await db.db.delete(people).where(inArray(people.id, [owner, member, outsider]));
    await db.close();
  }
});
