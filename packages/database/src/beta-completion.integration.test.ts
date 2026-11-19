import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
    BetaError, createPaymentReport, dismissPaymentReport, getTripRecap, listPaymentReports, loadSuccessorSource, recordPaymentReportReceipt, saveTripRecap,
} from "./beta-completion-repository";
import { addCommonsExpense, confirmCommonsExpensesComplete } from "./pilot-repository";
import { commons, itineraryItems, memberships, moments, paymentReports, people, reimbursements, stays } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

function testUrl() {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url && ["localhost", "127.0.0.1"].includes(new URL(url).hostname) && new URL(url).pathname.endsWith("_test"), "TEST_DATABASE_URL must be a local *_test database");
  return url;
}

async function fixture(url: string) {
  const database = createDatabase(url);
  const rows = await database.db.insert(people).values([
    { displayName: "Beta Organizer", authUserId: randomUUID() }, { displayName: "Beta Payer", authUserId: randomUUID() }, { displayName: "Beta Bystander", authUserId: randomUUID() },
  ]).returning({ id: people.id });
  const [organizer, payer, bystander] = rows.map(row => row.id) as [string, string, string];
  const [trip] = await database.db.insert(commons).values({ slug: `beta-${randomUUID().slice(0, 8)}`, name: "Beta Trip", timezone: "America/Denver", createdByPersonId: organizer }).returning({ id: commons.id, slug: commons.slug });
  await database.db.insert(memberships).values([
    { commonsId: trip!.id, personId: organizer, status: "active", role: "organizer" },
    { commonsId: trip!.id, personId: payer, status: "active", role: "member" },
    { commonsId: trip!.id, personId: bystander, status: "active", role: "member" },
  ]);
  return { database, organizer, payer, bystander, tripId: trip!.id, slug: trip!.slug, personIds: rows.map(row => row.id) };
}

async function cleanup(f: Awaited<ReturnType<typeof fixture>>) {
  await f.database.db.delete(commons).where(eq(commons.id, f.tripId));
  await f.database.db.delete(people).where(inArray(people.id, f.personIds)).catch(() => undefined);
  await f.database.close();
}

test("an I paid report never settles; only a recorded receipt does, once, per currency", { skip: !run }, async () => {
  const url = testUrl();
  const f = await fixture(url);
  try {
    const options = { databaseUrl: url };
    const organizerOptions = { ...options, actorPersonId: f.organizer };
    await addCommonsExpense(f.slug, { commandId: randomUUID(), title: "Dinner", amountCents: 10_000, paidByPersonId: f.organizer, occurredOn: "2027-06-24", category: "Food & drink", splitMethod: "equal",
      shares: [{ personId: f.organizer, amountCents: 5_000 }, { personId: f.payer, amountCents: 5_000 }] }, organizerOptions);

    const commandId = randomUUID();
    const report = await createPaymentReport(f.slug, { commandId, toPersonId: f.organizer, currency: "USD", amountCents: 5_000, note: "Venmo" }, { ...options, actorPersonId: f.payer });
    const replay = await createPaymentReport(f.slug, { commandId, toPersonId: f.organizer, currency: "USD", amountCents: 5_000 }, { ...options, actorPersonId: f.payer });
    assert.equal(replay.id, report.id, "the same command replays one report");
    assert.equal(report.status, "reported");
    assert.equal((await f.database.db.select().from(reimbursements).where(eq(reimbursements.commonsId, f.tripId))).length, 0, "a report records no reimbursement");

    assert.equal((await listPaymentReports(f.slug, { ...options, actorPersonId: f.bystander })).length, 0, "an uninvolved traveler cannot see it");
    assert.equal((await listPaymentReports(f.slug, { ...options, actorPersonId: f.payer })).length, 1);
    await assert.rejects(recordPaymentReportReceipt(f.slug, report.id, { occurredOn: "2027-06-25" }, { ...options, actorPersonId: f.payer }), (e: unknown) => e instanceof BetaError && e.code === "not_authorized");
    await assert.rejects(recordPaymentReportReceipt(f.slug, report.id, { occurredOn: "2027-06-25" }, { ...options, actorPersonId: f.bystander }), (e: unknown) => e instanceof BetaError && e.code === "not_authorized");

    const first = await recordPaymentReportReceipt(f.slug, report.id, { occurredOn: "2027-06-25" }, organizerOptions);
    const second = await recordPaymentReportReceipt(f.slug, report.id, { occurredOn: "2027-06-25" }, organizerOptions);
    assert.equal(first.status, "recorded");
    assert.equal(second.reimbursementId, first.reimbursementId);
    const recorded = await f.database.db.select().from(reimbursements).where(eq(reimbursements.commonsId, f.tripId));
    assert.equal(recorded.length, 1, "retrying records exactly one reimbursement");
    assert.equal(recorded[0]!.amountCents, 5_000);
    assert.equal(recorded[0]!.currency, "USD");

    // A report in another currency stays its own record and is never converted or netted.
    const euro = await createPaymentReport(f.slug, { commandId: randomUUID(), toPersonId: f.organizer, currency: "EUR", amountCents: 1_000 }, { ...options, actorPersonId: f.payer });
    assert.equal(euro.currency, "EUR");
    assert.equal((await dismissPaymentReport(f.slug, euro.id, organizerOptions)).status, "dismissed");
    assert.equal((await dismissPaymentReport(f.slug, euro.id, organizerOptions)).status, "dismissed", "dismissing twice is harmless");
    await assert.rejects(recordPaymentReportReceipt(f.slug, euro.id, { occurredOn: "2027-06-25" }, organizerOptions), (e: unknown) => e instanceof BetaError && e.code === "already_resolved");

    // A closed ledger blocks both new reports and recording.
    const another = await createPaymentReport(f.slug, { commandId: randomUUID(), toPersonId: f.organizer, currency: "USD", amountCents: 100 }, { ...options, actorPersonId: f.payer });
    await confirmCommonsExpensesComplete(f.slug, { commandId: randomUUID(), scope: "group" }, organizerOptions);
    await assert.rejects(createPaymentReport(f.slug, { commandId: randomUUID(), toPersonId: f.organizer, currency: "USD", amountCents: 100 }, { ...options, actorPersonId: f.payer }), (e: unknown) => e instanceof BetaError && e.code === "ledger_closed");
    await assert.rejects(recordPaymentReportReceipt(f.slug, another.id, { occurredOn: "2027-06-26" }, organizerOptions), (e: unknown) => e instanceof BetaError && e.code === "ledger_closed");
    assert.equal((await f.database.db.select().from(paymentReports).where(eq(paymentReports.id, another.id)))[0]!.status, "reported");
  } finally { await cleanup(f); }
});

test("recap shares only after organizer approval, with this trip's photos only; successor source is shared titles only", { skip: !run }, async () => {
  const url = testUrl();
  const f = await fixture(url);
  const other = await fixture(url);
  try {
    const options = { databaseUrl: url };
    const [photo] = await f.database.db.insert(moments).values({ commonsId: f.tripId, storagePath: "x/y.jpg", source: "web", sourceLabel: "Test", caption: "Last night", altText: "Table", occurredAt: new Date() } as never).returning({ id: moments.id });
    const [foreign] = await other.database.db.insert(moments).values({ commonsId: other.tripId, storagePath: "x/z.jpg", source: "web", sourceLabel: "Test", caption: "Not ours", altText: "x", occurredAt: new Date() } as never).returning({ id: moments.id });
    await assert.rejects(saveTripRecap(f.slug, { expectedVersion: 0, summary: "Hi", approvedMomentIds: [foreign!.id], share: true }, { ...options, actorPersonId: f.organizer }), (e: unknown) => e instanceof BetaError && e.code === "invalid");
    await assert.rejects(saveTripRecap(f.slug, { expectedVersion: 0, summary: "Hi", approvedMomentIds: [], share: true }, { ...options, actorPersonId: f.payer }), (e: unknown) => e instanceof BetaError && e.code === "not_authorized");
    const draft = await saveTripRecap(f.slug, { expectedVersion: 0, summary: "A good week.", approvedMomentIds: [photo!.id], share: false }, { ...options, actorPersonId: f.organizer });
    assert.equal(draft.status, "draft");
    assert.equal((await getTripRecap(f.slug, { ...options, actorPersonId: f.payer })).status, "none", "a traveler sees nothing until it is shared");
    await assert.rejects(saveTripRecap(f.slug, { expectedVersion: 0, summary: "stale", approvedMomentIds: [], share: false }, { ...options, actorPersonId: f.organizer }), (e: unknown) => e instanceof BetaError && e.code === "conflict");
    const shared = await saveTripRecap(f.slug, { expectedVersion: draft.version, summary: "A good week.", approvedMomentIds: [photo!.id], share: true }, { ...options, actorPersonId: f.organizer });
    assert.equal(shared.status, "shared");
    const seen = await getTripRecap(f.slug, { ...options, actorPersonId: f.payer });
    assert.deepEqual(seen.memories.map(m => m.caption), ["Last night"]);

    await f.database.db.insert(itineraryItems).values([
      { commonsId: f.tripId, title: "Everyone hike", timezone: "UTC", audience: "everyone", status: "idea", provenanceLabel: "t" },
      { commonsId: f.tripId, title: "Private surprise", timezone: "UTC", audience: "individual", status: "idea", provenanceLabel: "t" },
      { commonsId: f.tripId, title: "Cancelled thing", timezone: "UTC", audience: "everyone", status: "cancelled", provenanceLabel: "t" },
    ] as never);
    await f.database.db.insert(stays).values({ commonsId: f.tripId, name: "Lake House", status: "considering" } as never).catch(() => undefined);
    const source = await loadSuccessorSource(f.slug, { ...options, actorPersonId: f.bystander });
    assert.deepEqual(source.activities.map(a => a.title), ["Everyone hike"]);
    await assert.rejects(loadSuccessorSource(f.slug, { ...options, actorPersonId: randomUUID() }), (e: unknown) => e instanceof BetaError);
  } finally { await cleanup(f); await cleanup(other); }
});
