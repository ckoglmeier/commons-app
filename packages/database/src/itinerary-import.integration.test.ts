import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { ItineraryContentSchema } from "@commons/contracts";
import { createDatabase } from "./client";
import { commons, coordinatorThreads, coordinatorTurns, memberships, people, polls } from "./schema";
import { actOnCoordinatorWorkspace, createCoordinatorThread, getCoordinatorThread } from "./coordinator-repository";
import { createImportedItineraryDocument } from "./itinerary-import-repository";
import { itineraryContext, itineraryDocumentTurn, readItineraryDocumentRevisions } from "./research-itinerary-repository";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
const content = ItineraryContentSchema.parse({ title: "Imported Napa", brief: "", opening: "Rough plan.", items: [
  { id: "imp-dinner", kind: "meal", title: "Dinner", day: "2026-11-05", time: "19:00", endTime: null, travelAnchor: null, decision: null, location: "", note: "", participantNote: null, venue: null, participation: "group", alternative: false, evidence: "organizer_preference", sources: [], unresolved: [] },
], tasks: [], driverBrief: "", unresolved: [] });

async function seed() {
  const url = process.env.TEST_DATABASE_URL!; assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const db = createDatabase(url), trip = randomUUID(), otherTrip = randomUUID(), organizer = randomUUID(), traveler = randomUUID(), outsider = randomUUID();
  await db.db.insert(people).values([organizer, traveler, outsider].map(id => ({ id, displayName: `Synthetic ${id.slice(0, 4)}` })));
  await db.db.insert(commons).values([trip, otherTrip].map(id => ({ id, slug: id, name: "QA import", startsOn: "2026-11-05", endsOn: "2026-11-07", timezone: "America/Los_Angeles", createdByPersonId: organizer })));
  await db.db.insert(memberships).values([{ commonsId: trip, personId: organizer, role: "organizer" as const, status: "active" as const }, { commonsId: trip, personId: traveler, role: "member" as const, status: "active" as const },
    { commonsId: otherTrip, personId: outsider, role: "organizer" as const, status: "active" as const }]);
  const options = (actorPersonId = organizer) => ({ databaseUrl: url, actorPersonId, sharedCoordinator: true });
  const thread = (await createCoordinatorThread(trip, { commandId: randomUUID(), title: "Itinerary" }, options())).id;
  const foreignThread = (await createCoordinatorThread(otherTrip, { commandId: randomUUID(), title: "Theirs" }, options(outsider))).id;
  return { db, trip, otherTrip, organizer, traveler, outsider, thread, foreignThread, options,
    cleanup: async () => { await db.db.delete(commons).where(inArray(commons.id, [trip, otherTrip])); await db.db.delete(people).where(inArray(people.id, [organizer, traveler, outsider])); await db.close(); } };
}

test("an import creates the thread's private itinerary once, with history, and later edits use the existing revise command", { skip }, async () => {
  const s = await seed();
  try {
    const commandId = randomUUID(), input = { commandId, threadId: s.thread, content, sourceDigest: "a".repeat(64) };
    const [first, replay] = [await createImportedItineraryDocument(s.trip, input, s.options()), await createImportedItineraryDocument(s.trip, input, s.options())];
    assert.deepEqual(replay, first, "replay returns the same receipt");
    assert.equal(first.version, 1);
    const turns = await s.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, s.thread));
    assert.equal(turns.length, 1, "retry never duplicates the document turn");
    const saved = (await itineraryContext(s.trip, s.thread, s.options())).previous!;
    assert.equal(saved.id, first.documentId); assert.deepEqual(saved.content, content); assert.deepEqual(saved.receipts, []);
    const loaded = await getCoordinatorThread(s.trip, s.options(), undefined, s.thread);
    assert.equal(loaded.turns.at(-1)?.workspace?.itineraryDraft?.id, first.documentId);
    assert.match(loaded.turns.at(-1)!.assistantText, /Nothing was shared, added to the trip or booked/);
    assert.deepEqual((await readItineraryDocumentRevisions(s.trip, s.thread, first.documentId, s.options())).map(row => [row.version, row.commandId]), [[1, commandId]]);
    // A second create in the same thread is refused; the existing document is unchanged.
    await assert.rejects(createImportedItineraryDocument(s.trip, { ...input, commandId: randomUUID() }, s.options()));
    // Later changes go through the existing versioned revise command, with stale protection.
    const turn = (await itineraryDocumentTurn(s.trip, s.thread, s.options()))!;
    assert.deepEqual([turn.documentId, turn.version], [first.documentId, 1]);
    const next = { ...content, title: "Imported Napa v2" };
    const revised = await actOnCoordinatorWorkspace(s.trip, { action: "itinerary", operation: "revise", turnId: turn.turnId, threadId: s.thread, commandId: randomUUID(), expectedVersion: 1, content: next }, s.options()) as { version: number };
    assert.equal(revised.version, 2);
    await assert.rejects(actOnCoordinatorWorkspace(s.trip, { action: "itinerary", operation: "revise", turnId: turn.turnId, threadId: s.thread, commandId: randomUUID(), expectedVersion: 1, content }, s.options()), "stale base version");
    assert.equal((await itineraryContext(s.trip, s.thread, s.options())).previous!.content.title, "Imported Napa v2");
    assert.equal((await s.db.db.select().from(polls).where(eq(polls.commonsId, s.trip))).length, 0, "nothing published");
  } finally { await s.cleanup(); }
});

test("only organizers of the owning trip can create or locate the document", { skip }, async () => {
  const s = await seed();
  try {
    const input = () => ({ commandId: randomUUID(), threadId: s.thread, content, sourceDigest: "b".repeat(64) });
    await assert.rejects(createImportedItineraryDocument(s.trip, input(), s.options(s.traveler)), "traveler");
    await assert.rejects(createImportedItineraryDocument(s.trip, input(), s.options(s.outsider)), "outsider");
    await assert.rejects(createImportedItineraryDocument(s.trip, { ...input(), threadId: s.foreignThread }, s.options()), "another trip's thread");
    await assert.rejects(itineraryDocumentTurn(s.trip, s.thread, s.options(s.traveler)));
    await assert.rejects(createImportedItineraryDocument(s.trip, { ...input(), content: { ...content, items: [{ ...content.items[0], day: "2027-01-01" }] } }, s.options()), "outside trip dates");
    assert.equal((await s.db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.threadId, s.thread))).length, 0);
    await s.db.db.update(coordinatorThreads).set({ status: "archived" }).where(eq(coordinatorThreads.id, s.thread));
    await assert.rejects(createImportedItineraryDocument(s.trip, input(), s.options()), "archived thread");
  } finally { await s.cleanup(); }
});
