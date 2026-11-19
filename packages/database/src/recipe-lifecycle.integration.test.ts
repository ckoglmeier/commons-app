import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray } from "drizzle-orm";
import {
  attendanceQuestions, datesLocationQuestions, lodgingQuestions,
  type AttendanceRunDetail, type DatesLocationAlternative, type LodgingPropertyInput, type LodgingRunDetail, type RecipeRunDetail,
} from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError } from "./event-command";
import { getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus, PollRepositoryError } from "./poll-repository";
import { upsertCommonsFlightBooking } from "./pilot-repository";
import { getTransportReview } from "./recipe-transport-repository";
import { applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, listRecipeRuns, publishRecipeRound, startRecipeRun } from "./recipe-run-repository";
import { auditEvents, commons, memberships, people, polls, recipeOutcomes } from "./schema";

const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";

/** The cross-recipe fixture: a synthetic Thursday–Saturday wine-country trip, an own-bed requirement, a provisional guest and supplied lodging. */
test("dates → attendance → lodging share one trip context, and later changes mark only what depended on them", { skip }, async () => {
  const url = process.env.TEST_DATABASE_URL!;
  assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname), "Disposable local database only");
  const database = createDatabase(url), db = database.db;
  const event = randomUUID(), org = randomUUID(), ana = randomUUID(), ben = randomUUID(), cy = randomUUID();
  const as = (actorPersonId: string) => ({ databaseUrl: url, actorPersonId });
  await db.insert(people).values([[org, "Olive Organizer"], [ana, "Ana"], [ben, "Ben"], [cy, "Cy"]].map(([id, displayName]) => ({ id, displayName, authUserId: id })));
  await db.insert(commons).values({ id: event, slug: event, name: "Wine country weekend", createdByPersonId: org, timezone: "America/Los_Angeles", startsOn: "2027-04-01", endsOn: "2027-04-03", locationName: "Undecided", locationNames: ["Undecided"] });
  await db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, ...[ana, ben, cy].map(personId => ({ commonsId: event, personId, role: "member" as const, status: "active" as const }))]);
  const publish = async (runId: string, detail: RecipeRunDetail, access: "invitees" | "link") => publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: detail.draft.version, access }, as(org));
  const close = (pollId: string) => updateCommonsPollStatus(event, pollId, { commandId: randomUUID(), status: "closed" }, as(org));
  try {
    /* 1. Dates and location, approved and applied: the trip context the next recipes build on. */
    const napa: DatesLocationAlternative = { id: randomUUID(), startsOn: "2027-04-15", endsOn: "2027-04-17", place: "Napa" }, sonoma: DatesLocationAlternative = { id: randomUUID(), startsOn: "2027-04-22", endsOn: "2027-04-24", place: "Sonoma" };
    const datesRun = randomUUID();
    await startRecipeRun(event, { commandId: randomUUID(), runId: datesRun, draftId: randomUUID(), recipe: "dates_location", alternatives: [napa, sonoma] }, as(org));
    let dates = await getRecipeRun(event, datesRun, as(org));
    const datesPoll = await publish(datesRun, dates, "invitees");
    const dq = datesLocationQuestions((await getCommonsPollDetail(event, datesPoll.pollId, as(org))).questions)!;
    for (const [who, name] of [[ana, "Ana"], [ben, "Ben"]] as const) await submitPublicPollResponseByPublicId(datesPoll.publicId, { respondentName: name, expectedResponseUpdatedAt: null, answers: [{ questionId: dq.acceptable.id, optionIds: [napa.id], text: null }] }, url, { authUserId: who, email: null });
    await close(datesPoll.pollId);
    dates = await getRecipeRun(event, datesRun, as(org));
    const { outcomeId: datesOutcome } = await approveRecipeOutcome(event, datesRun, { commandId: randomUUID(), pollId: datesPoll.pollId, evidenceFingerprint: dates.evidenceFingerprint, alternativeId: napa.id, uncertaintyAcknowledged: true }, as(org)) as { outcomeId: string };
    dates = await getRecipeRun(event, datesRun, as(org));
    await applyRecipeOutcome(event, datesRun, { commandId: randomUUID(), outcomeId: datesOutcome, expected: dates.trip, applyDates: true, applyLocation: true }, as(org));
    const appliedTrip = { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] };

    /* 2. Attendance: asked about the applied dates and place; a link poll with a provisional guest and duplicate guest names. */
    const memberCount = (await db.select().from(memberships).where(eq(memberships.commonsId, event))).length, peopleCount = (await db.select().from(people)).length;
    const attRun = randomUUID();
    await assert.rejects(startRecipeRun(event, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "attendance" }, as(ana)), CommandAccessError);
    await startRecipeRun(event, { commandId: randomUUID(), runId: attRun, draftId: randomUUID(), recipe: "attendance" }, as(org));
    let attendance = await getRecipeRun(event, attRun, as(org)) as AttendanceRunDetail;
    const attPoll = await publish(attRun, attendance, "link");
    const attDetail = await getCommonsPollDetail(event, attPoll.pollId, as(org));
    assert.match(attDetail.intro ?? "", /Napa/, "attendance is asked about the approved place");
    assert.match(attDetail.intro ?? "", /doesn’t accept an invitation or change your RSVP/);
    const aq = attendanceQuestions(attDetail.questions)!;
    const pick = (state: "in" | "maybe" | "out") => aq.state.options.find(option => option.attendance === state)!.id, size = (n: number) => aq.party!.options.find(option => option.partySize === n)!.id;
    const guest = (name: string, state: "in" | "maybe" | "out", party: number | null) => submitPublicPollResponseByPublicId(attPoll.publicId, { respondentName: name, expectedResponseUpdatedAt: null,
      answers: [{ questionId: aq.state.id, optionIds: [pick(state)], text: null }, ...(party ? [{ questionId: aq.party!.id, optionIds: [size(party)], text: null }] : [])] }, url);
    await guest("Sam Guest", "in", 2); await guest("Sam Guest", "maybe", 1); await guest("Pat Guest", "out", null);
    await submitPublicPollResponseByPublicId(attPoll.publicId, { respondentName: "Ben", expectedResponseUpdatedAt: null, answers: [{ questionId: aq.state.id, optionIds: [pick("in")], text: null }, { questionId: aq.party!.id, optionIds: [size(1)], text: null }] }, url, { authUserId: ben, email: null });
    assert.equal((await db.select().from(people)).length, peopleCount, "an answer never creates an account or person");
    assert.equal((await db.select().from(memberships).where(eq(memberships.commonsId, event))).length, memberCount, "an answer never creates or accepts a membership");
    attendance = await getRecipeRun(event, attRun, as(org)) as AttendanceRunDetail;
    assert.equal(attendance.summary?.duplicates.length, 1, "two guests with one name are never merged silently");
    assert.equal(attendance.summary?.counts.unanswered, 0, "a link poll cannot say who hasn't answered");
    await close(attPoll.pollId);
    attendance = await getRecipeRun(event, attRun, as(org)) as AttendanceRunDetail;
    const ids = attendance.summary!.duplicates[0].responseIds;
    const approve = (patch: object) => approveRecipeOutcome(event, attRun, { commandId: randomUUID(), pollId: attPoll.pollId, evidenceFingerprint: attendance.evidenceFingerprint, uncertaintyAcknowledged: true, ...patch }, as(org));
    await assert.rejects(approve({}), /more than once/);
    await assert.rejects(approve({ excludedResponseIds: [randomUUID()] }), PollRepositoryError);
    await assert.rejects(approve({ excludedResponseIds: [ids[1]], organizerEntries: [{ personId: ben, state: "out" }] }), /already answered/, "an organizer cannot override a person's own answer");
    await assert.rejects(approve({ excludedResponseIds: [ids[1]], organizerEntries: [{ personId: randomUUID(), state: "in" }] }), /isn’t on this trip/);
    const attOutcome = await approve({ excludedResponseIds: [ids[1]], organizerEntries: [{ personId: cy, state: "maybe", partySize: 1, note: "Said so on the phone" }], exceptions: ["Pat may rejoin"] }) as { outcomeId: string };
    attendance = await getRecipeRun(event, attRun, as(org)) as AttendanceRunDetail;
    const result = attendance.outcome!.result;
    assert.equal(result.kind, "attendance");
    if (result.kind !== "attendance") throw new Error("attendance result");
    assert.deepEqual(result.counts, { in: 2, maybe: 1, out: 1, unanswered: 0 });
    assert.deepEqual(result.headcount, { in: 3, maybe: 1 }, "Sam answered for two people and Ben for one; Cy is a maybe");
    assert.deepEqual(result.people.find(person => person.name === "Cy"), { personId: cy, name: "Cy", state: "maybe", partySize: 1, source: "organizer_entered", note: "Said so on the phone", enteredBy: "Olive Organizer" });
    assert.equal(result.excludedResponses, 1);
    const [cyMembership] = await db.select().from(memberships).where(and(eq(memberships.commonsId, event), eq(memberships.personId, cy)));
    assert.equal(cyMembership.attendanceState, "helping", "an organizer's note about Cy never becomes Cy's own RSVP");
    assert.deepEqual(attendance.headcount && { in: attendance.headcount.in, maybe: attendance.headcount.maybe }, { in: 3, maybe: 1 });
    await assert.rejects(applyRecipeOutcome(event, attRun, { commandId: randomUUID(), outcomeId: attOutcome.outcomeId, expected: appliedTrip, applyDates: true, applyLocation: true }, as(org)), /doesn’t change the trip/);

    /* 3. Lodging: supplied places, an own-bed requirement against a king-only place, headcount carried from attendance. */
    const inn: LodgingPropertyInput = { id: randomUUID(), name: "Vineyard Inn", url: "https://example.com/inn", description: "Walkable to town", rooms: "Six king rooms", beds: "king_only",
      pricing: { basis: "per_room", period: "nightly", currency: "USD", minCents: 28000, maxCents: 34000, fees: "unknown" } };
    const house: LodgingPropertyInput = { id: randomUUID(), name: "Valley House", url: "https://example.com/house", description: null, rooms: "Four rooms, two with twin beds", beds: "separate_beds_available",
      pricing: { basis: "total", period: "stay", currency: "USD", minCents: null, maxCents: null, fees: "unknown" } };
    await assert.rejects(startRecipeRun(event, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "lodging", properties: [inn] }, as(org)));
    await assert.rejects(startRecipeRun(event, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "lodging", properties: [inn, { ...house, url: "not a link" }] }, as(org)));
    await assert.rejects(startRecipeRun(event, { commandId: randomUUID(), runId: randomUUID(), draftId: randomUUID(), recipe: "lodging", properties: [inn, { ...house, pricing: { ...house.pricing, minCents: 5, maxCents: null } }] }, as(org)), /both ends/);
    const stayRun = randomUUID();
    await startRecipeRun(event, { commandId: randomUUID(), runId: stayRun, draftId: randomUUID(), recipe: "lodging", properties: [inn, house], askAboutChildren: true }, as(org));
    let stay = await getRecipeRun(event, stayRun, as(org)) as LodgingRunDetail;
    assert.deepEqual(stay.headcount && { in: stay.headcount.in, maybe: stay.headcount.maybe }, { in: 3, maybe: 1 }, "lodging starts from the approved headcount");
    const stayPoll = await publish(stayRun, stay, "invitees");
    const sq = lodgingQuestions((await getCommonsPollDetail(event, stayPoll.pollId, as(org))).questions)!;
    const sleep = (need: string) => sq.sleeping!.options.find(option => option.sleeping === need)!.id;
    const answer = (who: string, name: string, ok: string[], prefer: string | null, need: string, child?: boolean) => submitPublicPollResponseByPublicId(stayPoll.publicId, { respondentName: name, expectedResponseUpdatedAt: null,
      answers: [{ questionId: sq.acceptable.id, optionIds: ok, text: null }, ...(prefer ? [{ questionId: sq.preferred!.id, optionIds: [prefer], text: null }] : []), { questionId: sq.sleeping!.id, optionIds: [sleep(need)], text: null },
        ...(child === undefined ? [] : [{ questionId: sq.children!.id, optionIds: [sq.children!.options.find(option => option.label === (child ? "Yes" : "No"))!.id], text: null }])] }, url, { authUserId: who, email: null });
    await answer(ana, "Ana", [inn.id, house.id], inn.id, "own_bed", true);
    await answer(ben, "Ben", [inn.id], null, "share_bed", false);
    stay = await getRecipeRun(event, stayRun, as(org)) as LodgingRunDetail;
    const innRow = stay.summary!.rows.find(row => row.property.id === inn.id)!, houseRow = stay.summary!.rows.find(row => row.property.id === house.id)!;
    assert.match(innRow.conflicts[0], /Ana asked for their own bed or separate beds, and this place lists only king beds/);
    assert.deepEqual(houseRow.conflicts, []);
    assert.match(innRow.pricing, /Organizer’s estimate: \$280–\$340 per room, per night; fees unknown\. Not a quote\./);
    assert.equal(houseRow.pricing, "Price unknown");
    assert.deepEqual(stay.summary!.childrenYes, ["Ana"]); assert.deepEqual(stay.summary!.sleeping.own_bed, ["Ana"]);
    await close(stayPoll.pollId);
    stay = await getRecipeRun(event, stayRun, as(org)) as LodgingRunDetail;
    const chooseStay = (patch: object) => approveRecipeOutcome(event, stayRun, { commandId: randomUUID(), pollId: stayPoll.pollId, evidenceFingerprint: stay.evidenceFingerprint, optionId: inn.id, uncertaintyAcknowledged: true, ...patch }, as(org));
    await assert.rejects(chooseStay({}), /bed conflicts/, "a conflict has to be acknowledged before approval");
    await assert.rejects(chooseStay({ optionId: randomUUID() }), PollRepositoryError);
    const stayOutcome = await chooseStay({ acknowledgedConflicts: innRow.conflicts }) as { outcomeId: string };
    stay = await getRecipeRun(event, stayRun, as(org)) as LodgingRunDetail;
    const staySaved = stay.outcome!.result;
    if (staySaved.kind !== "lodging") throw new Error("lodging result");
    assert.equal(staySaved.name, "Vineyard Inn"); assert.deepEqual(staySaved.conflictsAcknowledged, innRow.conflicts);
    assert.deepEqual([staySaved.basedOn.headcountIn, staySaved.basedOn.attendanceOutcomeId], [3, attOutcome.outcomeId]);
    assert.equal(stay.stage, "decided"); assert.deepEqual(stay.outcome!.stale, []);
    assert.equal((await db.select().from(polls).where(eq(polls.commonsId, event))).length, 3, "no extra polls, bookings or notifications were created");
    assert.equal((await db.select().from(auditEvents).where(and(eq(auditEvents.commonsId, event), eq(auditEvents.action, "commons.details_updated")))).length, 1, "only the explicitly applied dates recipe changed the trip");
    void stayOutcome;

    /* 4. A later change flags only what depended on it; every earlier decision stays on record. */
    await db.update(commons).set({ startsOn: "2027-04-22", endsOn: "2027-04-24" }).where(eq(commons.id, event));
    const runs = await listRecipeRuns(event, as(org));
    const byId = new Map(runs.map(run => [run.id, run]));
    assert.deepEqual(byId.get(datesRun)!.stale.map(item => item.field), ["dates"], "the applied dates result notices a later date edit");
    assert.deepEqual(byId.get(attRun)!.stale.map(item => item.field), ["dates"]);
    assert.deepEqual(byId.get(stayRun)!.stale.map(item => item.field), ["dates"]);
    assert.match(byId.get(attRun)!.stale[0].message, /Attendance was asked for/);
    const outcomes = await db.select().from(recipeOutcomes).where(inArray(recipeOutcomes.runId, [datesRun, attRun, stayRun]));
    assert.deepEqual(outcomes.map(row => row.status).sort(), ["applied", "approved", "approved"], "stale results keep their recorded status");

    // A revised headcount is a new attendance result; lodging chosen against the old one is flagged, not rewritten.
    const attRun2 = randomUUID();
    await startRecipeRun(event, { commandId: randomUUID(), runId: attRun2, draftId: randomUUID(), recipe: "attendance" }, as(org));
    let second = await getRecipeRun(event, attRun2, as(org)) as AttendanceRunDetail;
    const poll2 = await publish(attRun2, second, "invitees");
    const q2 = attendanceQuestions((await getCommonsPollDetail(event, poll2.pollId, as(org))).questions)!;
    for (const who of [ana, ben, cy]) await submitPublicPollResponseByPublicId(poll2.publicId, { respondentName: "x", expectedResponseUpdatedAt: null, answers: [{ questionId: q2.state.id, optionIds: [q2.state.options.find(option => option.attendance === "in")!.id], text: null },
      ...(who === ana ? [{ questionId: q2.party!.id, optionIds: [q2.party!.options.find(option => option.partySize === 2)!.id], text: null }] : [])] }, url, { authUserId: who, email: null });
    await close(poll2.pollId);
    second = await getRecipeRun(event, attRun2, as(org)) as AttendanceRunDetail;
    assert.equal(second.summary!.counts.unanswered, 1, "the organizer, an invitee, has not answered and is not counted");
    await approveRecipeOutcome(event, attRun2, { commandId: randomUUID(), pollId: poll2.pollId, evidenceFingerprint: second.evidenceFingerprint, uncertaintyAcknowledged: true }, as(org));
    const after = await getRecipeRun(event, stayRun, as(org)) as LodgingRunDetail;
    assert.deepEqual(after.outcome!.stale.map(item => item.field).sort(), ["dates", "headcount"]);
    assert.match(after.outcome!.stale.find(item => item.field === "headcount")!.message, /chosen with 3 people confirmed and 1 maybe\. Attendance now says 4\./);

    /* 5. Rides read the same attendance result: someone recorded as in is confirmed even if they never set their own RSVP. */
    for (const [who, time] of [[ana, "15:10"], [ben, "15:30"]] as const) await upsertCommonsFlightBooking(event, { commandId: randomUUID(), legs: [{ kind: "arrival", route: "DEN → SFO", date: "2027-04-22", time }], includedPersonIds: [who], note: "" }, as(who));
    const rides = (await getTransportReview(event, as(org))).proposal.groups[0];
    assert.deepEqual(rides.members.map(member => [member.name, member.provisional]), [["Ana", false], ["Ben", false]]);
    const [anaMembership] = await db.select().from(memberships).where(and(eq(memberships.commonsId, event), eq(memberships.personId, ana)));
    assert.equal(anaMembership.attendanceState, "helping", "recording attendance never set Ana's own RSVP");
  } finally {
    await db.delete(commons).where(eq(commons.id, event));
    await db.delete(people).where(inArray(people.id, [org, ana, ben, cy]));
    await database.close();
  }
});
