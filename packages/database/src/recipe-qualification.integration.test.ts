import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { and, eq, inArray, sql } from "drizzle-orm";
import { attendanceQuestions, type AttendanceRunDetail } from "@commons/contracts";
import { createDatabase } from "./client";
import { CommandAccessError } from "./event-command";
import { getCommonsPollDetail, submitPublicPollResponseByPublicId, updateCommonsPollStatus } from "./poll-repository";
import { applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, listRecipeRuns, publishRecipeRound, reviseRecipeRound, startRecipeRun } from "./recipe-run-repository";
import { getTransportReview } from "./recipe-transport-repository";
import { commons, memberships, people } from "./schema";
const skip = process.env.COMMONS_RUN_DATABASE_TESTS !== "1";
async function fixture() {
  const url = process.env.TEST_DATABASE_URL!;
  assert.equal(new URL(url).hostname, "127.0.0.1"); assert.ok(new URL(url).pathname.endsWith("_test"));
  const database = createDatabase(url), db = database.db, event = randomUUID(), org = randomUUID(), traveler = randomUUID();
  await db.insert(people).values([{ id: org, authUserId: org, displayName: "Organizer" }, { id: traveler, authUserId: traveler, displayName: "Traveler" }]);
  await db.insert(commons).values({ id: event, slug: event, name: "Synthetic qualification", createdByPersonId: org, timezone: "UTC", startsOn: "2027-04-01", endsOn: "2027-04-03", locationNames: ["Napa", "Sonoma"], locationName: "Napa" });
  await db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: traveler, role: "member", status: "active" }]);
  const as = (actorPersonId = org) => ({ databaseUrl: url, actorPersonId });
  const runId = randomUUID(), alternativeId = randomUUID();
  const start = async (recipe: "attendance" | "dates_location") => {
    await startRecipeRun(event, { commandId: randomUUID(), runId, draftId: randomUUID(), recipe, ...(recipe === "dates_location" ? { alternatives: [{ id: alternativeId, startsOn: "2027-05-01", endsOn: "2027-05-03", place: "Napa" }, { id: randomUUID(), startsOn: "2027-05-08", endsOn: "2027-05-10", place: "Sonoma" }] } : {}) }, as());
    const detail = await getRecipeRun(event, runId, as());
    return publishRecipeRound(event, runId, { commandId: randomUUID(), expectedDraftVersion: detail.draft.version, access: "invitees" }, as());
  };
  const approveDates = async () => {
    const poll = await start("dates_location");
    await updateCommonsPollStatus(event, poll.pollId, { commandId: randomUUID(), status: "closed" }, as());
    const detail = await getRecipeRun(event, runId, as());
    const result = await approveRecipeOutcome(event, runId, { commandId: randomUUID(), pollId: poll.pollId, evidenceFingerprint: detail.evidenceFingerprint, alternativeId, uncertaintyAcknowledged: true }, as());
    return { detail, outcomeId: result.outcomeId };
  };
  return { db, database, url, event, org, traveler, as, runId, start, approveDates, cleanup: async () => { await db.delete(commons).where(eq(commons.id, event)); await db.delete(people).where(inArray(people.id, [org, traveler])); await database.close(); } };
}
test("attendance cannot exclude an authenticated answer to replace it with an organizer note", { skip }, async () => {
  const f = await fixture(); try {
    const poll = await f.start("attendance"), q = attendanceQuestions((await getCommonsPollDetail(f.event, poll.pollId, f.as())).questions)!;
    await submitPublicPollResponseByPublicId(poll.publicId, { respondentName: "Traveler", expectedResponseUpdatedAt: null, answers: [{ questionId: q.state.id, optionIds: [q.state.options.find(o => o.attendance === "out")!.id], text: null }] }, f.url, { authUserId: f.traveler, email: null });
    await updateCommonsPollStatus(f.event, poll.pollId, { commandId: randomUUID(), status: "closed" }, f.as());
    const d = await getRecipeRun(f.event, f.runId, f.as()) as AttendanceRunDetail;
    await assert.rejects(approveRecipeOutcome(f.event, f.runId, { commandId: randomUUID(), pollId: poll.pollId, evidenceFingerprint: d.evidenceFingerprint, excludedResponseIds: [d.summary!.people.find(p => p.key === f.traveler)!.responseId], organizerEntries: [{ personId: f.traveler, state: "in" }], uncertaintyAcknowledged: true }, f.as()), /already answered|duplicate guest/);
  } finally { await f.cleanup(); }
});
test("an approved outcome from a revised round cannot change the trip", { skip }, async () => {
  const f = await fixture(); try {
    const { detail, outcomeId } = await f.approveDates();
    await reviseRecipeRound(f.event, f.runId, { commandId: randomUUID(), expectedDraftVersion: detail.draft.version }, f.as());
    await assert.rejects(applyRecipeOutcome(f.event, f.runId, { commandId: randomUUID(), outcomeId, expected: detail.trip, applyDates: true, applyLocation: false }, f.as()), /replaced|superseded/i);
  } finally { await f.cleanup(); }
});
test("location-only apply replaces the complete location list with the reviewed place", { skip }, async () => {
  const f = await fixture(); try {
    const { detail, outcomeId } = await f.approveDates();
    await applyRecipeOutcome(f.event, f.runId, { commandId: randomUUID(), outcomeId, expected: detail.trip, applyDates: false, applyLocation: true }, f.as());
    const after = await getRecipeRun(f.event, f.runId, f.as());
    assert.deepEqual(after.trip, { ...detail.trip, locationNames: ["Napa"] });
  } finally { await f.cleanup(); }
});
for (const operation of ["list", "get", "transport"] as const) test(`recipe ${operation} waits for membership changes under the event lock`, { skip }, async () => {
  const f = await fixture(); try {
    await f.start("attendance");
    let release!: () => void, locked!: () => void;
    const gate = new Promise<void>(r => { release = r; }), ready = new Promise<void>(r => { locked = r; });
    const mutation = f.db.transaction(async tx => {
      await tx.execute(sql`select id from commons where id = ${f.event} for update`);
      await tx.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.org)));
      locked(); await gate;
    });
    await ready;
    const read = operation === "list" ? listRecipeRuns(f.event, f.as()) : operation === "get" ? getRecipeRun(f.event, f.runId, f.as()) : getTransportReview(f.event, f.as());
    const observed = read.then(() => "resolved", e => e);
    await new Promise(r => setTimeout(r, 150)); release(); await mutation;
    assert.ok(await observed instanceof CommandAccessError, "must recheck the committed role after waiting on the event lock");
  } finally { await f.cleanup(); }
});

test("revision retries return the same replacement draft", { skip }, async () => {
  const f = await fixture(); try {
    await f.start("attendance");
    const d = await getRecipeRun(f.event, f.runId, f.as());
    const request = { commandId: randomUUID(), expectedDraftVersion: d.draft.version };
    const first = await reviseRecipeRound(f.event, f.runId, request, f.as());
    assert.deepEqual(await reviseRecipeRound(f.event, f.runId, request, f.as()), first);
  } finally { await f.cleanup(); }
});

test("attendance keeps the dates people were asked about when the trip changes before approval", { skip }, async () => {
  const f = await fixture(); try {
    const poll = await f.start("attendance");
    const q = attendanceQuestions((await getCommonsPollDetail(f.event, poll.pollId, f.as())).questions)!;
    await submitPublicPollResponseByPublicId(poll.publicId, { expectedResponseUpdatedAt: null, answers: [{ questionId: q.state.id, optionIds: [q.state.options.find(option => option.attendance === "in")!.id], text: null }] }, f.url, { authUserId: f.traveler, email: null });
    await f.db.update(commons).set({ startsOn: "2027-06-01", endsOn: "2027-06-03" }).where(eq(commons.id, f.event));
    await updateCommonsPollStatus(f.event, poll.pollId, { commandId: randomUUID(), status: "closed" }, f.as());
    const d = await getRecipeRun(f.event, f.runId, f.as());
    await approveRecipeOutcome(f.event, f.runId, { commandId: randomUUID(), pollId: poll.pollId, evidenceFingerprint: d.evidenceFingerprint, uncertaintyAcknowledged: true }, f.as());
    const after = await getRecipeRun(f.event, f.runId, f.as());
    assert.equal(after.outcome!.result.kind, "attendance");
    if (after.outcome!.result.kind === "attendance") assert.equal(after.outcome!.result.basedOn.startsOn, "2027-04-01");
    assert.deepEqual(after.outcome!.stale.map(s => s.field), ["dates"]);
  } finally { await f.cleanup(); }
});

test("a demoted recipe creator cannot close voting through the shared poll command", { skip }, async () => {
  const f = await fixture(); try {
    const poll = await f.start("attendance");
    await f.db.update(memberships).set({ role: "member" }).where(and(eq(memberships.commonsId, f.event), eq(memberships.personId, f.org)));
    await assert.rejects(updateCommonsPollStatus(f.event, poll.pollId, { commandId: randomUUID(), status: "closed" }, f.as()), /organizer/i);
  } finally { await f.cleanup(); }
});
