import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eventCreationDraftPeople, eventCreationDrafts, itineraryItems, reimbursements } from "@commons/database";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, withTestDatabase, eq } from "../test-support/database-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const files = {
  reports: "../../app/api/v1/commons/[slug]/payment-reports/route",
  report: "../../app/api/v1/commons/[slug]/payment-reports/[reportId]/route",
  recap: "../../app/api/v1/commons/[slug]/recap/route",
  next: "../../app/api/v1/commons/[slug]/next-trip/route",
} as const;
async function routes() {
  const entries = await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await import(file)] as const));
  return Object.fromEntries(entries) as Record<keyof typeof files, Record<string, Handler>>;
}
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (slug: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...extra }) });

test("beta money journey: I paid never settles; a recorded receipt does once; recap and successor reuse only what was chosen", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip();
  const slug = `qa-${trip.eventId}`;
  try {
    const r = await routes();
    // Traveler reports a payment.
    actAs(trip.travelerId);
    const reported = await r.reports.POST!(req("/x", "POST", { commandId: randomUUID(), toPersonId: trip.organizerId, currency: "USD", amountCents: 4_000, note: "Cash" }), ctx(slug));
    assert.equal(reported.status, 201);
    const report = (await reported.json() as { report: { id: string; status: string } }).report;
    assert.equal(report.status, "reported");
    assert.equal((await withTestDatabase(db => db.select().from(reimbursements).where(eq(reimbursements.commonsId, trip.eventId)))).length, 0, "a report alone records nothing");

    // The reporter cannot record their own receipt; a co-organizer who is not the payee can.
    assert.equal((await r.report.POST!(req("/x", "POST", { action: "record", occurredOn: "2027-02-16" }), ctx(slug, { reportId: report.id }))).status, 403);
    actAs(trip.coOrganizerId);
    const recorded = await r.report.POST!(req("/x", "POST", { action: "record", occurredOn: "2027-02-16" }), ctx(slug, { reportId: report.id }));
    assert.equal(recorded.status, 200);
    const again = await r.report.POST!(req("/x", "POST", { action: "record", occurredOn: "2027-02-16" }), ctx(slug, { reportId: report.id }));
    assert.equal(again.status, 200);
    const body = await recorded.json() as { report: { status: string }; snapshot: { state: { reimbursements: { amountCents: number; currency: string }[] } } };
    assert.equal(body.report.status, "recorded");
    assert.deepEqual(body.snapshot.state.reimbursements.map(row => [row.amountCents, row.currency]), [[4_000, "USD"]]);
    assert.equal((await withTestDatabase(db => db.select().from(reimbursements).where(eq(reimbursements.commonsId, trip.eventId)))).length, 1, "recording twice is one reimbursement");

    // Recap: draft is organizer-only; sharing makes it visible to a traveler.
    actAs(trip.organizerId);
    const draft = await r.recap.PUT!(req("/x", "PUT", { expectedVersion: 0, summary: "Great weekend.", approvedMomentIds: [], share: false }), ctx(slug));
    assert.equal(draft.status, 200);
    actAs(trip.travelerId);
    assert.equal(((await (await r.recap.GET!(req("/x", "GET"), ctx(slug))).json()) as { recap: { status: string } }).recap.status, "none");
    assert.equal((await r.recap.PUT!(req("/x", "PUT", { expectedVersion: 1, summary: "Hijack", approvedMomentIds: [], share: true }), ctx(slug))).status, 403);
    actAs(trip.organizerId);
    assert.equal((await r.recap.PUT!(req("/x", "PUT", { expectedVersion: 1, summary: "Great weekend.", approvedMomentIds: [], share: true }), ctx(slug))).status, 200);
    actAs(trip.travelerId);
    assert.equal(((await (await r.recap.GET!(req("/x", "GET"), ctx(slug))).json()) as { recap: { summary: string } }).recap.summary, "Great weekend.");

    // Successor draft by a traveler: through the existing creation path, reusing only the chosen title and destination.
    await withTestDatabase(db => db.insert(itineraryItems).values([
      { commonsId: trip.eventId, title: "Ski the Breck", timezone: "UTC", audience: "everyone", status: "planned", provenanceLabel: "t", startsAt: new Date("2027-02-13T15:00:00Z") },
      { commonsId: trip.eventId, title: "Surprise dinner", timezone: "UTC", audience: "individual", status: "idea", provenanceLabel: "t" },
    ] as never));
    const choices = await (await r.next.GET!(req("/x", "GET"), ctx(slug))).json() as { source: { activities: { id: string; title: string }[]; stays: { id: string }[] } };
    assert.deepEqual(choices.source.activities.map(a => a.title), ["Ski the Breck"], "audience-limited items are not offered");
    const made = await r.next.POST!(req("/x", "POST", { commandId: randomUUID(), activityIds: [choices.source.activities[0]!.id], stayIds: [], keepDestination: true, includePeople: false, timezone: "America/Denver" }), ctx(slug));
    assert.equal(made.status, 201);
    const { draftId, path } = await made.json() as { draftId: string; path: string };
    assert.equal(path, `/new/?draft=${draftId}`);
    const [saved] = await withTestDatabase(db => db.select().from(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId)));
    assert.deepEqual([saved!.startsOn, saved!.endsOn], [null, null], "no dates carry over");
    assert.equal(saved!.locationName, "Breckenridge, Colorado");
    assert.equal(saved!.proposedName, "Synthetic Breckenridge weekend");
    assert.deepEqual((saved!.brief as { goals: string[] }).goals, ["Do again? Ski the Breck"]);
    assert.equal((await withTestDatabase(db => db.select().from(eventCreationDraftPeople).where(eq(eventCreationDraftPeople.draftId, draftId)))).length, 0, "the earlier group is not carried over unless chosen");
    // The earlier trip's records are untouched.
    assert.equal((await withTestDatabase(db => db.select().from(reimbursements).where(eq(reimbursements.commonsId, trip.eventId)))).length, 1);
    await withTestDatabase(async db => { await db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId)); });
  } finally { await trip.cleanup(); }
});

test("a non-member cannot read or change another trip's money wrap-up", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip();
  const outsider = await seedSyntheticTrip();
  const slug = `qa-${trip.eventId}`;
  try {
    const r = await routes();
    actAs(outsider.organizerId);
    assert.equal((await r.reports.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.recap.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.next.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.reports.POST!(req("/x", "POST", { commandId: randomUUID(), toPersonId: trip.organizerId, currency: "USD", amountCents: 100 }), ctx(slug))).status, 403);
  } finally { await trip.cleanup(); await outsider.cleanup(); }
});
