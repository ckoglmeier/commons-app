import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { productAnalyticsEvents, recordServerOutcomeEvent } from "@commons/database";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, testDatabaseUrl, withTestDatabase, eq } from "../test-support/database-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

test("server outcomes: one row per outcome across retries; role comes from saved membership, never the request", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip();
  const { outcomeEventId } = await import("./outcome-telemetry");
  const ids: string[] = [];
  try {
    const url = testDatabaseUrl();
    const record = async (event: "expense_added" | "poll_response_saved", key: string, authUserId: string | null) => {
      const id = outcomeEventId(event, key); ids.push(id);
      return recordServerOutcomeEvent({ id, eventName: event, authUserId, tripIdentifier: trip.eventId, properties: { outcome: "succeeded", internal: false, sample: false } }, url);
    };
    const command = randomUUID();
    const first = await record("expense_added", command, trip.travelerId);
    const retry = await record("expense_added", command, trip.travelerId);
    assert.deepEqual([first.inserted, retry.inserted], [true, false], "a retried command inserts once");
    assert.equal(first.role, "participant");
    assert.equal(first.tripId, trip.eventId);
    assert.equal((await record("expense_added", randomUUID(), trip.organizerId)).role, "organizer");
    assert.equal((await record("poll_response_saved", randomUUID(), null)).role, "guest", "a link respondent stays a guest");
    assert.equal((await record("poll_response_saved", randomUUID(), randomUUID())).role, "guest", "a signed-in non-member is not a participant");
    const rows = await withTestDatabase(db => db.select().from(productAnalyticsEvents).where(eq(productAnalyticsEvents.commonsSlug, trip.eventId)));
    assert.equal(rows.length, 4);
    for (const row of rows) {
      assert.equal(row.pagePath, "/server/outcome");
      assert.equal((row.properties as Record<string, unknown>).source, "server");
      assert.deepEqual(Object.keys(row.properties as object).sort(), ["internal", "outcome", "role", "sample", "source"]);
    }
  } finally {
    for (const id of ids) await withTestDatabase(db => db.delete(productAnalyticsEvents).where(eq(productAnalyticsEvents.id, id)));
    await trip.cleanup();
  }
});

test("browser events cannot claim to be server outcomes or store raw campaign text", { skip: !databaseTestsEnabled }, async () => {
  const { sanitizedEventProperties } = await import("../analytics-event-policy");
  assert.deepEqual(sanitizedEventProperties({ source: "server", internal: false, release: "x", utmSource: "Splitwise", utmCampaign: "a@b.co?x=1", tab: "money" }),
    { utmSource: "splitwise", utmCampaign: "other", tab: "money" });
});

test("review fix: the browser route refuses forged server outcomes, and the report ignores rows without the server marker", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip();
  try {
    actAs(trip.organizerId);
    const route = await import("../../app/api/v1/analytics/events/route");
    const send = (body: Record<string, unknown>) => route.POST(new Request("http://localhost/api/v1/analytics/events", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ anonymousId: randomUUID(), sessionId: randomUUID(), pagePath: "/", properties: {}, occurredAt: new Date().toISOString(), ...body }) }));
    assert.equal((await send({ eventName: "trip_created", pagePath: "/server/outcome" })).status, 400, "server path refused");
    assert.equal((await send({ eventName: "operation_failed", properties: { operation: "FORGED_OP" } })).status, 400, "server-only event refused");
    assert.equal((await send({ eventName: "poll_assist_generation" })).status, 400);
    assert.equal((await send({ eventName: "trip_created", pagePath: "/./server/outcome" })).status, 400, "normalised server path refused");
    assert.equal((await send({ eventName: "page_view" })).status, 201, "ordinary browser events still record");
    // A legacy row on the server path without the server marker (written before the fix) is not counted.
    const { createProductAnalyticsEvent, loadServerOutcomeCounts } = await import("@commons/database");
    const legacy = await createProductAnalyticsEvent({ eventName: "trip_created", anonymousId: randomUUID(), sessionId: randomUUID(), pagePath: "/server/outcome", properties: {}, occurredAt: new Date().toISOString() }, testDatabaseUrl());
    const now = new Date(), counts = await loadServerOutcomeCounts({ startsAt: new Date(now.getTime() - 60_000), endsAt: new Date(now.getTime() + 60_000) }, testDatabaseUrl());
    assert.equal(counts.outcomes.trip_created ?? 0, 0);
    assert.equal(counts.failures.FORGED_OP, undefined);
    await withTestDatabase(db => db.delete(productAnalyticsEvents).where(eq(productAnalyticsEvents.id, legacy.id)));
  } finally { await trip.cleanup(); }
});

test("review fix: equal client command ids on two trips stay two outcomes", { skip: !databaseTestsEnabled }, async () => {
  const { recordOutcome } = await import("./outcome-telemetry");
  const ids: string[] = [], tasks: Array<Promise<void>> = [];
  const deps = { identity: async () => null, schedule: (task: () => Promise<void>) => { tasks.push(task()); },
    persist: async (input: { id: string }) => { ids.push(input.id); return { inserted: true, tripId: null, role: "guest" as const }; } };
  recordOutcome({ event: "expense_added", key: "1", trip: "trip-a" }, deps);
  recordOutcome({ event: "expense_added", key: "1", trip: "trip-b" }, deps);
  await Promise.all(tasks);
  assert.notEqual(ids[0], ids[1]);
});
