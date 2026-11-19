import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommonsRepositoryError, updateTripLetter } from "./pilot-repository";
import { auditEvents, commons, memberships, people, processedCommands } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
const sections = [
  { id: "latest", hidden: false }, { id: "welcome", hidden: false },
  { id: "facts", hidden: false }, { id: "photo", hidden: true },
];

test("the trip letter saves only presentation, for organizers, without overwriting newer edits", { skip: !run }, async () => {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname) && new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url);
  const db = database.db;
  const suffix = randomUUID().slice(0, 8);
  const personIds: string[] = [];
  let tripId: string | null = null;
  try {
    const person = async (name: string) => { const [row] = await db.insert(people).values({ displayName: name }).returning({ id: people.id }); personIds.push(row.id); return row.id; };
    const organizer = await person("Letter Organizer"), traveler = await person("Letter Traveler"), removed = await person("Letter Removed");
    const slug = `letter-${suffix}`;
    const [trip] = await db.insert(commons).values({ slug, name: "Letter trip", timezone: "UTC", startsOn: "2031-07-18", endsOn: "2031-07-25", createdByPersonId: organizer } as never).returning({ id: commons.id });
    tripId = trip.id;
    await db.insert(memberships).values([
      { commonsId: trip.id, personId: organizer, role: "organizer", status: "active" },
      { commonsId: trip.id, personId: traveler, role: "member", status: "active" },
      { commonsId: trip.id, personId: removed, role: "organizer", status: "removed" },
    ] as never);
    const options = { databaseUrl: url, actorPersonId: organizer };

    const commandId = randomUUID();
    const saved = await updateTripLetter(slug, { commandId, welcome: { text: "  See you on the Cape.  ", expected: null } }, options);
    assert.equal(saved!.commons.welcomeMessage, "See you on the Cape.");
    assert.equal(saved!.commons.welcomeAuthorPersonId, organizer);

    // A retry of the same command is a no-op, even though its expectation is now stale.
    await updateTripLetter(slug, { commandId, welcome: { text: "See you on the Cape.", expected: null } }, options);
    const audits = await db.select().from(auditEvents).where(eq(auditEvents.commandId, commandId));
    assert.equal(audits.length, 1);

    // A stale editor cannot overwrite the newer welcome.
    await assert.rejects(
      updateTripLetter(slug, { commandId: randomUUID(), welcome: { text: "Older text", expected: null } }, options),
      (error: unknown) => error instanceof CommonsRepositoryError && error.code === "letter_conflict",
    );

    // Travelers and removed organizers cannot change it.
    for (const actorPersonId of [traveler, removed]) {
      await assert.rejects(
        updateTripLetter(slug, { commandId: randomUUID(), welcome: { text: "Mine now", expected: "See you on the Cape." } }, { databaseUrl: url, actorPersonId }),
        (error: unknown) => error instanceof CommonsRepositoryError && error.code === "actor_not_authorized",
      );
    }

    // Arranging is saved, conflict-checked and reset, and changes no trip facts.
    const arranged = await updateTripLetter(slug, { commandId: randomUUID(), sections: { value: sections, expected: null } }, options);
    assert.deepEqual(arranged!.commons.letterSections, sections);
    assert.equal(arranged!.commons.startsOn, "2031-07-18");
    await assert.rejects(
      updateTripLetter(slug, { commandId: randomUUID(), sections: { value: null, expected: null } }, options),
      (error: unknown) => error instanceof CommonsRepositoryError && error.code === "letter_conflict",
    );
    const reset = await updateTripLetter(slug, { commandId: randomUUID(), sections: { value: null, expected: sections } }, options);
    assert.equal(reset!.commons.letterSections, null);

    // Unknown or duplicate sections, and executable-looking extras, never validate.
    await assert.rejects(updateTripLetter(slug, { commandId: randomUUID(), sections: { value: [...sections.slice(0, 3), { id: "custom", hidden: false }], expected: null } }, options));
    await assert.rejects(updateTripLetter(slug, { commandId: randomUUID(), sections: { value: [sections[0], sections[0], sections[1], sections[2]], expected: null } }, options));
    await assert.rejects(updateTripLetter(slug, { commandId: randomUUID(), welcome: { text: "x".repeat(701), expected: "See you on the Cape." } }, options));

    // Clearing the welcome clears its author.
    const cleared = await updateTripLetter(slug, { commandId: randomUUID(), welcome: { text: "", expected: "See you on the Cape." } }, options);
    assert.equal(cleared!.commons.welcomeMessage, null);
    assert.equal(cleared!.commons.welcomeAuthorPersonId, null);
  } finally {
    if (tripId) {
      await db.delete(auditEvents).where(eq(auditEvents.commonsId, tripId));
      await db.delete(processedCommands).where(eq(processedCommands.commonsId, tripId));
      await db.delete(memberships).where(eq(memberships.commonsId, tripId));
      await db.delete(commons).where(eq(commons.id, tripId));
    }
    if (personIds.length) await db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
