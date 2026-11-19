import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { eventCreationDraftPeople, eventCreationDrafts, feedbackSubmissions, itineraryItems, operatorActions, partnerInquiries, reimbursements, attributionEvents } from "@commons/database";
import { actAs, databaseTestsEnabled, seedSyntheticTrip, withTestDatabase, eq } from "./coordinator-route-harness";
import { registerComponentImportStubs } from "../test-support/hook-harness";

registerComponentImportStubs();

type Handler = (request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
const files = {
  reports: "../../app/api/v1/commons/[slug]/payment-reports/route",
  report: "../../app/api/v1/commons/[slug]/payment-reports/[reportId]/route",
  recap: "../../app/api/v1/commons/[slug]/recap/route",
  next: "../../app/api/v1/commons/[slug]/next-trip/route",
  inquiries: "../../app/api/v1/beta/inquiries/route",
  brief: "../../app/api/v1/beta/brief/route",
  drafts: "../../app/api/v1/event-creation-drafts/route",
  feedback: "../../app/api/v1/feedback/route",
} as const;
async function routes() {
  const entries = await Promise.all(Object.entries(files).map(async ([key, file]) => [key, await import(file)] as const));
  return Object.fromEntries(entries) as Record<keyof typeof files, Record<string, Handler>>;
}
const BETA_KEYS = ["COMMONS_BETA_REWORK_ENABLED", "COMMONS_BETA_KILL_INQUIRY", "COMMONS_PARTNER_INQUIRY_ROUTE_EMAIL", "COMMONS_EMAIL_SEND_MODE", "RESEND_API_KEY"];
function flags(values: Record<string, string>) { for (const key of BETA_KEYS) delete process.env[key]; Object.assign(process.env, values); }
const req = (path: string, method: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request(`http://localhost${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (slug: string, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ slug, ...extra }) });

test("with the master flag off every beta route is closed, and the existing creation and feedback routes behave as before", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    flags({ COMMONS_BETA_REWORK_ENABLED: "false" });
    actAs(trip.organizerId);
    const r = await routes();
    const slug = `qa-${trip.eventId}`;
    const closed: Array<[Promise<Response>, string]> = [
      [r.reports.GET!(req("/x", "GET"), ctx(slug)), "reports GET"],
      [r.reports.POST!(req("/x", "POST", { commandId: randomUUID() }), ctx(slug)), "reports POST"],
      [r.report.POST!(req("/x", "POST", { action: "dismiss" }), ctx(slug, { reportId: randomUUID() })), "report POST"],
      [r.recap.GET!(req("/x", "GET"), ctx(slug)), "recap GET"],
      [r.recap.PUT!(req("/x", "PUT", {}), ctx(slug)), "recap PUT"],
      [r.next.GET!(req("/x", "GET"), ctx(slug)), "next GET"],
      [r.next.POST!(req("/x", "POST", {}), ctx(slug)), "next POST"],
      [r.inquiries.POST!(req("/x", "POST", {}), ctx(slug)), "inquiry"],
      [r.brief.POST!(req("/x", "POST", { brief: "Commons trip brief v1\nTrip: X" }), ctx(slug)), "brief"],
    ];
    for (const [pending, name] of closed) assert.equal((await pending).status, 404, `${name} is closed`);
    // Existing draft creation still works and records no attribution.
    const created = await r.drafts.POST!(req("/api/v1/event-creation-drafts", "POST", { sourceKind: "description", title: "Moab weekend", timezone: "America/Denver", entry: "template:girls-trip" }), ctx(slug));
    assert.equal(created.status, 201);
    const draft = (await created.json() as { draft: { id: string } }).draft;
    assert.equal((await withTestDatabase(db => db.select().from(attributionEvents).where(eq(attributionEvents.subjectKey, draft.id)))).length, 0);
    await withTestDatabase(db => db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draft.id)));
  } finally { flags({}); await trip.cleanup(); }
});

test("beta money journey: I paid never settles; a recorded receipt does once; recap and successor reuse only what was chosen", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const slug = `qa-${trip.eventId}`;
  try {
    flags({ COMMONS_BETA_REWORK_ENABLED: "true" });
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
    const attribution = await withTestDatabase(db => db.select().from(attributionEvents).where(eq(attributionEvents.entryRef, "plan-the-next-one")));
    assert.ok(attribution.some(row => row.event === "traveler_to_organizer" && row.entryKind === "recap"));
    assert.ok(attribution.every(row => !JSON.stringify(row).includes(trip.travelerId)), "no person is recorded");
    // The earlier trip's records are untouched.
    assert.equal((await withTestDatabase(db => db.select().from(reimbursements).where(eq(reimbursements.commonsId, trip.eventId)))).length, 1);
    await withTestDatabase(async db => { await db.delete(eventCreationDrafts).where(eq(eventCreationDrafts.id, draftId)); await db.delete(attributionEvents).where(eq(attributionEvents.entryRef, "plan-the-next-one")); });
  } finally { flags({}); await trip.cleanup(); }
});

test("a non-member cannot read or change another trip's money wrap-up", { skip: !databaseTestsEnabled }, async () => {
  const trip = await seedSyntheticTrip({ pilot: false });
  const outsider = await seedSyntheticTrip({ pilot: false });
  const slug = `qa-${trip.eventId}`;
  try {
    flags({ COMMONS_BETA_REWORK_ENABLED: "true" });
    const r = await routes();
    actAs(outsider.organizerId);
    assert.equal((await r.reports.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.recap.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.next.GET!(req("/x", "GET"), ctx(slug))).status, 403);
    assert.equal((await r.reports.POST!(req("/x", "POST", { commandId: randomUUID(), toPersonId: trip.organizerId, currency: "USD", amountCents: 100 }), ctx(slug))).status, 403);
  } finally { flags({}); await trip.cleanup(); await outsider.cleanup(); }
});

test("the operator overview lists actionable failures without private content, and reviewed is not resolved", { skip: !databaseTestsEnabled }, async () => {
  const marker = randomUUID().slice(0, 8);
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    flags({ COMMONS_BETA_REWORK_ENABLED: "true" });
    actAs(trip.organizerId);
    const { betaOperatorOverview } = await import("./beta-completion");
    const { createPartnerInquiry, completePartnerInquiry, leasePartnerInquiry, recordOperatorAction } = await import("@commons/database");
    const url = process.env.TEST_DATABASE_URL!;
    const created = await createPartnerInquiry({ kind: "dmo", organization: `Visit ${marker}`, contactName: "Pat", contactEmail: `pat-${marker}@example.test`, website: null, region: null,
      message: `PRIVATE-LOOKING MESSAGE ${marker} for the operator only.`, sourcePath: "/destinations", idempotencyKey: randomUUID(), clientHash: `ov-${marker}`, routedTo: "ops@example.test" }, { perClientPerHour: 5, globalPerHour: 1000 }, { databaseUrl: url });
    await leasePartnerInquiry(created.id!, { databaseUrl: url });
    await completePartnerInquiry(created.id!, 1, { sent: false, errorCode: "provider_unavailable" }, { databaseUrl: url });
    const overview = await betaOperatorOverview(url);
    const failure = overview.failures.find(item => item.id === created.id)!;
    assert.deepEqual([failure.kind, failure.state, failure.retryable], ["partner_inquiry", "open", true]);
    assert.ok(!JSON.stringify(overview.failures).includes("PRIVATE-LOOKING"), "failures carry classification only, not message text");
    assert.ok(!JSON.stringify(overview.failures).includes(`pat-${marker}`), "failures carry no contact details");
    const inquiry = overview.inquiries.find(row => row.id === created.id)!;
    assert.equal(inquiry.deliveryStatus, "failed");
    assert.equal(inquiry.deliveryErrorCode, "provider_unavailable");

    await recordOperatorAction({ operatorPersonId: trip.organizerId, subjectKind: "partner_inquiry", subjectId: created.id!, action: "reviewed" }, { databaseUrl: url });
    assert.equal((await betaOperatorOverview(url)).failures.find(item => item.id === created.id)!.state, "reviewed");
    await recordOperatorAction({ operatorPersonId: trip.organizerId, subjectKind: "partner_inquiry", subjectId: created.id!, action: "resolved" }, { databaseUrl: url });
    assert.equal((await betaOperatorOverview(url)).inquiries.find(row => row.id === created.id)!.state, "resolved");
  } finally {
    flags({});
    await withTestDatabase(async db => { await db.delete(operatorActions).where(eq(operatorActions.operatorPersonId, trip.organizerId)); await db.delete(partnerInquiries).where(eq(partnerInquiries.clientHash, `ov-${marker}`)); });
    await trip.cleanup();
  }
});

test("partner inquiries are stored and quietly deduplicated; nothing is sent in tests; feedback spam is bounded", { skip: !databaseTestsEnabled }, async () => {
  const marker = randomUUID().slice(0, 8);
  const body = (message: string) => ({ kind: "travel_assistant", organization: `Assist ${marker}`, contactName: "Sam", contactEmail: `sam-${marker}@example.test`, message, sourcePath: "/partners?token=x", idempotencyKey: randomUUID(), elapsedMs: 9000 });
  const trip = await seedSyntheticTrip({ pilot: false });
  try {
    // No route configured and sending disabled: the inquiry is saved and shows as not routed. No provider is called.
    flags({ COMMONS_BETA_REWORK_ENABLED: "true", COMMONS_EMAIL_SEND_MODE: "disabled" });
    actAs(trip.organizerId);
    const r = await routes();
    const first = await r.inquiries.POST!(req("/api/v1/beta/inquiries", "POST", body(`We build trip plans for groups ${marker}.`), { "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}` }), ctx("x"));
    assert.equal(first.status, 201);
    assert.deepEqual(await first.json(), { received: true });
    const [row] = await withTestDatabase(db => db.select().from(partnerInquiries).where(eq(partnerInquiries.contactEmail, `sam-${marker}@example.test`)));
    assert.equal(row!.deliveryStatus, "not_routed");
    assert.equal(row!.sourcePath, "/partners");
    assert.equal(row!.routedTo, null);
    assert.equal(row!.deliveryAttempts, 0);
    const dup = await r.inquiries.POST!(req("/x", "POST", body(`We build trip plans for groups ${marker}.`)), ctx("x"));
    assert.equal(dup.status, 200);
    assert.equal((await withTestDatabase(db => db.select().from(partnerInquiries).where(eq(partnerInquiries.contactEmail, `sam-${marker}@example.test`)))).length, 1);
    assert.equal((await r.inquiries.POST!(req("/x", "POST", { ...body("Long enough message here."), fax: "bot" }), ctx("x"))).status, 202);
    assert.equal((await r.inquiries.POST!(req("/x", "POST", body("Visit http://a.example http://b.example http://c.example now")), ctx("x"))).status, 422);

    // Feedback spam bound: a flood from one trip context is limited; an identical double send is one report.
    const feedback = (message: string) => ({ commonsSlug: `qa-${trip.eventId}`, source: "feedback_button", questionVersion: 2, answers: { category: "problem", message }, pagePath: "/c/x?view=plan", idempotencyKey: randomUUID() });
    const sent: number[] = [];
    for (let index = 0; index < 10; index += 1) sent.push((await r.feedback.POST!(req("/x", "POST", feedback(`Problem number ${index}`)), ctx("x"))).status);
    assert.deepEqual(sent, [201, 201, 201, 201, 201, 201, 201, 201, 429, 429]);
    flags({});
    await withTestDatabase(db => db.delete(feedbackSubmissions).where(eq(feedbackSubmissions.commonsSlug, `qa-${trip.eventId}`)));
    flags({ COMMONS_BETA_REWORK_ENABLED: "true" });
    const one = await r.feedback.POST!(req("/x", "POST", feedback("Same words")), ctx("x")), two = await r.feedback.POST!(req("/x", "POST", feedback("same   words")), ctx("x"));
    assert.equal(((await one.json()) as { id: string }).id, ((await two.json()) as { id: string }).id);
  } finally {
    flags({});
    await withTestDatabase(async db => { await db.delete(partnerInquiries).where(eq(partnerInquiries.contactEmail, `sam-${marker}@example.test`)); await db.delete(feedbackSubmissions).where(eq(feedbackSubmissions.commonsSlug, `qa-${trip.eventId}`)); });
    await trip.cleanup();
  }
});
