import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommonsRepositoryError, updateCommonsArchived } from "./pilot-repository";
import { auditEvents, commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("organizers can archive and restore a trip without changing membership", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Archive Organizer", authUserId: randomUUID() },
      { displayName: "Archive Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `archive-${randomUUID().slice(0, 8)}`,
      name: "Archived Trip Test",
      startsOn: "2025-06-01",
      endsOn: "2025-06-04",
      timezone: "America/Denver",
      status: "planning",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
    ]);

    const archiveCommandId = randomUUID();
    const organizerOptions = { databaseUrl, actorPersonId: personIds[0]! };
    const archived = await updateCommonsArchived(event.slug, {
      commandId: archiveCommandId,
      archived: true,
    }, organizerOptions);
    assert.equal(archived?.commons.status, "archived");
    assert.equal(archived?.participants.length, 2);

    const repeated = await updateCommonsArchived(event.slug, {
      commandId: archiveCommandId,
      archived: true,
    }, organizerOptions);
    assert.equal(repeated?.commons.status, "archived");
    const archiveAuditRows = await database.db.select({ id: auditEvents.id })
      .from(auditEvents)
      .where(and(
        eq(auditEvents.commonsId, commonsId),
        eq(auditEvents.commandId, archiveCommandId),
      ));
    assert.equal(archiveAuditRows.length, 1);

    await assert.rejects(
      updateCommonsArchived(event.slug, {
        commandId: randomUUID(),
        archived: false,
      }, { databaseUrl, actorPersonId: personIds[1]! }),
      (error: unknown) => error instanceof CommonsRepositoryError
        && error.code === "actor_not_authorized",
    );

    const restored = await updateCommonsArchived(event.slug, {
      commandId: randomUUID(),
      archived: false,
    }, organizerOptions);
    assert.equal(restored?.commons.status, "closing");
    assert.equal(restored?.participants.length, 2);

    const activeMemberships = await database.db.select({ id: memberships.id })
      .from(memberships)
      .where(and(
        eq(memberships.commonsId, commonsId),
        eq(memberships.status, "active"),
      ));
    assert.equal(activeMemberships.length, 2);
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
