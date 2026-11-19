import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { commons, coordinatorTurns, expenses, memberships, people, stays, stayParticipants } from "./schema";
import { actOnCoordinatorWorkspace, commitCoordinatorTurn, createCoordinatorThread, getCoordinatorThread } from "./coordinator-repository";

test("a reviewed thread action atomically saves budget and lodging with an attributed receipt", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), event = randomUUID(), organizer = randomUUID(), coorganizer = randomUUID(), traveler = randomUUID(), outsider = randomUUID();
  const options = { databaseUrl: url, actorPersonId: organizer, sharedCoordinator: true };
  const stayId = randomUUID();
  try {
    await db.db.insert(people).values([organizer, coorganizer, traveler, outsider].map(id => ({ id, displayName: `Synthetic ${id.slice(0, 4)}`, authUserId: id })));
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic mountain trip", timezone: "America/Denver", createdByPersonId: organizer,
      startsOn: "2026-12-20", endsOn: "2026-12-24", targetBudgetCents: 200_000 });
    await db.db.insert(memberships).values([{ commonsId: event, personId: organizer, role: "organizer", status: "active" },
      { commonsId: event, personId: coorganizer, role: "organizer", status: "active" }, { commonsId: event, personId: traveler, role: "member", status: "active" }]);
    await db.db.insert(stays).values({ id: stayId, commonsId: event, createdByPersonId: organizer, name: "Mountain rental", address: "Old address",
      startsOn: "2026-12-20", endsOn: "2026-12-23", status: "planned", totalCents: 266_653, costSource: "estimate", sourceLabel: "Synthetic fixture" });
    await db.db.insert(stayParticipants).values({ stayId, personId: traveler });
    const [existing] = await db.db.select().from(stays).where(eq(stays.id, stayId));
    const thread = await createCoordinatorThread(event, { commandId: randomUUID(), title: "Settle lodging" }, options);
    const base = { budgetCents: 200_000, startsOn: "2026-12-20", endsOn: "2026-12-24", locationName: null,
      stay: { id: stayId, name: "Mountain rental", address: "Old address", startsOn: "2026-12-20", endsOn: "2026-12-23",
        status: "planned" as const, totalCents: 266_653, currency: "USD" as const, bookingUrl: null, updatedAt: existing.updatedAt.toISOString() },
      includedPersonIds: [traveler] };
    const proposal = { version: 1, state: "pending" as const, source: "organizer request", base,
      changes: { ...base, budgetCents: 300_000, stay: { ...base.stay, address: "100 Synthetic Lane", status: "confirmed" as const } },
      operations: ["budget", "stay"] as Array<"budget" | "stay">, travelers: [{ id: traveler, name: "Synthetic traveler" }], receipt: null };
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, threadId: thread.id, prompt: "Set the budget to $3,000 and record lodging", draftId: null, draftVersion: null },
      "Review below. Nothing saved.", null, options, { tripConversation: true, tripProposal: proposal });
    const turnId = (await getCoordinatorThread(event, options, undefined, thread.id)).turns[0].id;
    assert.equal((await db.db.select().from(commons).where(eq(commons.id, event)))[0].targetBudgetCents, 200_000, "conversation does not save");
    const action = { turnId, threadId: thread.id, commandId: randomUUID(), action: "apply_trip" as const, expectedVersion: 1 };
    await assert.rejects(actOnCoordinatorWorkspace(event, action, { ...options, actorPersonId: outsider }), "non-organizer cannot apply");
    await actOnCoordinatorWorkspace(event, action, { ...options, actorPersonId: coorganizer });
    await actOnCoordinatorWorkspace(event, action, { ...options, actorPersonId: coorganizer });
    const [savedEvent] = await db.db.select().from(commons).where(eq(commons.id, event));
    const [savedStay] = await db.db.select().from(stays).where(eq(stays.id, stayId));
    assert.equal(savedEvent.targetBudgetCents, 300_000);
    assert.equal(savedEvent.startsOn, "2026-12-20", "stay dates do not rewrite trip dates");
    assert.equal(savedStay.address, "100 Synthetic Lane");
    assert.equal(savedStay.status, "confirmed");
    assert.equal(savedStay.totalCents, 266_653);
    assert.equal((await db.db.select().from(expenses).where(eq(expenses.commonsId, event))).length, 0, "a reported cost is not an expense");
    const receipt = (await getCoordinatorThread(event, options, undefined, thread.id)).turns[0].workspace?.tripProposal?.receipt;
    assert.equal(receipt?.stayId, stayId);
    assert.ok(receipt?.appliedBy.startsWith("Synthetic"));
    await assert.rejects(actOnCoordinatorWorkspace(event, { ...action, expectedVersion: 2 }, { ...options, actorPersonId: coorganizer }), "reused command cannot approve altered content");

    // A stale budget aborts the entire bundle before lodging can change.
    const current = await db.db.select().from(stays).where(eq(stays.id, stayId));
    const second = { ...proposal, base: { ...proposal.base, budgetCents: 300_000, stay: { ...proposal.base.stay, address: savedStay.address, status: savedStay.status, updatedAt: current[0].updatedAt.toISOString() } },
      changes: { ...proposal.changes, budgetCents: 350_000, stay: { ...proposal.changes.stay, address: "200 Synthetic Lane", updatedAt: current[0].updatedAt.toISOString() } } };
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 1, threadId: thread.id, prompt: "Change budget and lodging again", draftId: null, draftVersion: null },
      "Review below.", null, options, { tripConversation: true, tripProposal: second });
    const laterId = (await getCoordinatorThread(event, options, undefined, thread.id)).turns[1].id;
    await db.db.update(commons).set({ targetBudgetCents: 310_000 }).where(eq(commons.id, event));
    await assert.rejects(actOnCoordinatorWorkspace(event, { turnId: laterId, threadId: thread.id, commandId: randomUUID(), action: "apply_trip", expectedVersion: 1 }, options));
    assert.equal((await db.db.select().from(stays).where(eq(stays.id, stayId)))[0].address, "100 Synthetic Lane");
    assert.equal((await db.db.select().from(coordinatorTurns).where(eq(coordinatorTurns.id, laterId)))[0].workspace?.tripProposal?.state, "pending");
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(inArray(people.id, [organizer, coorganizer, traveler, outsider]));
    await db.close();
  }
});

test("new lodging review survives edits and reload, then creates one stay only after approval", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), event = randomUUID(), organizer = randomUUID();
  const options = { databaseUrl: url, actorPersonId: organizer, sharedCoordinator: true };
  try {
    await db.db.insert(people).values({ id: organizer, displayName: "Synthetic Organizer", authUserId: organizer });
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic lodging trip", timezone: "America/Denver", createdByPersonId: organizer });
    await db.db.insert(memberships).values({ commonsId: event, personId: organizer, role: "organizer", status: "active" });
    const thread = await createCoordinatorThread(event, { commandId: randomUUID(), title: "Book a base" }, options);
    const base = { budgetCents: null, startsOn: null, endsOn: null, locationName: null, stay: null, includedPersonIds: [] as string[] };
    const changes = { ...base, stay: { id: null, name: "New rental", address: "Old synthetic address", startsOn: "2026-12-20",
      endsOn: "2026-12-23", status: "confirmed" as const, totalCents: 88_000, currency: "USD" as const, bookingUrl: null, updatedAt: null } };
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, threadId: thread.id, prompt: "Record a booked stay", draftId: null, draftVersion: null },
      "Review before saving.", null, options, { tripConversation: true, tripProposal: { version: 1, state: "pending", source: "organizer request", base,
        changes, operations: ["stay"], travelers: [{ id: organizer, name: "Synthetic Organizer" }], receipt: null } });
    const turn = (await getCoordinatorThread(event, options, undefined, thread.id)).turns[0];
    assert.equal((await db.db.select().from(stays).where(eq(stays.commonsId, event))).length, 0);
    const revised = { ...changes, stay: { ...changes.stay, address: "400 Synthetic Lane" }, includedPersonIds: [organizer] };
    await actOnCoordinatorWorkspace(event, { turnId: turn.id, threadId: thread.id, commandId: randomUUID(), action: "revise_trip", expectedVersion: 1, changes: revised }, options);
    assert.equal((await getCoordinatorThread(event, options, undefined, thread.id)).turns[0].workspace?.tripProposal?.version, 2);
    assert.equal((await db.db.select().from(stays).where(eq(stays.commonsId, event))).length, 0, "editing the proposal never creates a stay");
    await assert.rejects(actOnCoordinatorWorkspace(event, { turnId: turn.id, threadId: thread.id, commandId: randomUUID(), action: "apply_trip", expectedVersion: 1 }, options));
    const action = { turnId: turn.id, threadId: thread.id, commandId: randomUUID(), action: "apply_trip" as const, expectedVersion: 2 };
    await actOnCoordinatorWorkspace(event, action, options);
    await actOnCoordinatorWorkspace(event, action, options);
    const saved = await db.db.select().from(stays).where(eq(stays.commonsId, event));
    assert.equal(saved.length, 1);
    assert.equal(saved[0].address, "400 Synthetic Lane");
    assert.equal(saved[0].costSource, "estimate", "reported cost is not a payment or verified receipt");
    assert.equal((await db.db.select().from(expenses).where(eq(expenses.commonsId, event))).length, 0);
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(eq(people.id, organizer));
    await db.close();
  }
});

test("a thread can apply dates and destination without shifting a saved stay", { skip: process.env.COMMONS_RUN_DATABASE_TESTS !== "1" }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname));
  const db = createDatabase(url), event = randomUUID(), organizer = randomUUID(), stayId = randomUUID();
  const options = { databaseUrl: url, actorPersonId: organizer, sharedCoordinator: true };
  try {
    await db.db.insert(people).values({ id: organizer, displayName: "Synthetic Organizer", authUserId: organizer });
    await db.db.insert(commons).values({ id: event, slug: event, name: "Synthetic dates trip", timezone: "America/Denver", createdByPersonId: organizer,
      startsOn: "2026-12-20", endsOn: "2026-12-24", locationName: "Steamboat Springs", locationNames: ["Steamboat Springs"] });
    await db.db.insert(memberships).values({ commonsId: event, personId: organizer, role: "organizer", status: "active" });
    await db.db.insert(stays).values({ id: stayId, commonsId: event, createdByPersonId: organizer, name: "Existing stay", address: "Synthetic address",
      startsOn: "2026-12-20", endsOn: "2026-12-23", status: "planned", sourceLabel: "Synthetic fixture" });
    const thread = await createCoordinatorThread(event, { commandId: randomUUID(), title: "Move the trip" }, options);
    const base = { budgetCents: null, startsOn: "2026-12-20", endsOn: "2026-12-24", locationName: "Steamboat Springs", stay: null, includedPersonIds: [] as string[] };
    const changes = { ...base, startsOn: "2027-01-10", endsOn: "2027-01-14", locationName: "Aspen" };
    await commitCoordinatorTurn(event, { commandId: randomUUID(), version: 0, threadId: thread.id,
      prompt: "Move the trip to January 10–14 in Aspen", draftId: null, draftVersion: null }, "Review the trip change.", null, options,
    { tripConversation: true, tripProposal: { version: 1, state: "pending", source: "organizer request", base, changes,
      operations: ["dates", "destination"], travelers: [], receipt: null } });
    const turn = (await getCoordinatorThread(event, options, undefined, thread.id)).turns[0];
    await actOnCoordinatorWorkspace(event, { turnId: turn.id, threadId: thread.id, commandId: randomUUID(), action: "apply_trip", expectedVersion: 1 }, options);
    const [savedEvent] = await db.db.select().from(commons).where(eq(commons.id, event));
    const [savedStay] = await db.db.select().from(stays).where(eq(stays.id, stayId));
    assert.equal(savedEvent.startsOn, "2027-01-10");
    assert.equal(savedEvent.endsOn, "2027-01-14");
    assert.equal(savedEvent.locationName, "Aspen");
    assert.deepEqual(savedEvent.locationNames, ["Aspen"]);
    assert.equal(savedStay.startsOn, "2026-12-20", "trip dates do not silently change existing lodging");
    assert.equal(savedStay.endsOn, "2026-12-23");
  } finally {
    await db.db.delete(commons).where(eq(commons.id, event));
    await db.db.delete(people).where(eq(people.id, organizer));
    await db.close();
  }
});
