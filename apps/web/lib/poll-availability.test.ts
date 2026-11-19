import assert from "node:assert/strict";
import test from "node:test";
import { CreatePollRequestSchema, PollWorkingDataSchema, PublicPollSchema, formatPollSchedule, type PollAvailability, type PollQuestion, type PollSchedule } from "@commons/contracts";
import { newPollOption } from "./poll-builder";
import { pollAnswerLabel, pollResponseError } from "./poll-response";
import { updatePollChoiceSelection } from "./poll-selection";

const schedule = { startsOn: "2027-03-13", endsOn: "2027-03-13", startTime: "", endTime: "" };
function question(mode: PollAvailability["mode"] = "days", patch: Partial<PollSchedule> = {}): Extract<PollQuestion, { kind: "choice" }> {
  const availability = { mode, timezone: "America/Denver" };
  const dates = { ...schedule, ...patch };
  return { id: crypto.randomUUID(), kind: "choice", prompt: "Which days?", required: true, selectionMode: "multiple", availability,
    options: [{ ...newPollOption(formatPollSchedule(dates, availability)), schedule: dates }, { ...newPollOption("None of these works"), exclusive: true }] };
}
const payload = (q: PollQuestion) => ({ commandId: crypto.randomUUID(), title: "Find a date", intro: null, ballotMode: "transparent", questions: [q] });

test("calendar dates, trip ranges and local time windows survive publish parsing", () => {
  for (const q of [question(), question("ranges", { endsOn: "2027-03-16" }), question("times", { startTime: "09:00", endTime: "10:30" })]) {
    const saved = CreatePollRequestSchema.parse(payload(q));
    assert.deepEqual(saved.questions, [q]);
    assert.ok(q.options[0].label.includes("2027"));
  }
  assert.match(question("times", { startTime: "00:00", endTime: "12:00" }).options[0].label, /12:00 AM–12:00 PM · America\/Denver/);
});

test("incomplete date fields save as private drafts but cannot publish", () => {
  const q = question(); q.options[0].schedule = { startsOn: "", endsOn: "", startTime: "", endTime: "" };
  assert.ok(PollWorkingDataSchema.safeParse(payload(q)).success);
  assert.equal(CreatePollRequestSchema.safeParse(payload(q)).success, false);
});

test("invalid dates, reversed ranges, invalid and incomplete times fail closed", () => {
  for (const q of [question("days", { startsOn: "2027-02-30", endsOn: "2027-02-30" }),
    question("ranges", { endsOn: "2027-03-12" }), question("days", { endsOn: "2027-03-15" }),
    question("times", { startTime: "10:00", endTime: "09:00" }), question("times", { startTime: "25:00", endTime: "26:00" }),
    question("times", { startTime: "10:00" }), question("times", { startTime: "09:00", endTime: "09:00" }), question("days", { startTime: "09:00" })]) {
    assert.equal(CreatePollRequestSchema.safeParse(payload(q)).success, false, JSON.stringify(q));
  }
});

test("date questions reject misleading labels, duplicates, mixed kinds and unknown zones", () => {
  const variants = [question(), question(), question(), question(), question(), question()];
  variants[0].options[0].label = "A different date";
  variants[1].options.push({ ...variants[1].options[0], id: crypto.randomUUID() });
  variants[2].selectionMode = "single";
  variants[3].availability!.timezone = "Nowhere/Invalid";
  variants[4].availability = undefined;
  variants[5].options[1].exclusive = false;
  for (const q of variants) assert.equal(CreatePollRequestSchema.safeParse(payload(q)).success, false);
});

test("none works is an explicit response; dates never become event mutations", () => {
  const q = question();
  const answer = { questionId: q.id, optionIds: [q.options[1].id], text: null };
  assert.equal(pollResponseError([q], [answer]), null);
  assert.equal(pollAnswerLabel(q, answer), "None of these works");
  assert.deepEqual(updatePollChoiceSelection([q.options[0].id], q.options[1].id, "multiple", true, [q.options[1].id]), [q.options[1].id]);
  assert.deepEqual(updatePollChoiceSelection([q.options[1].id], q.options[0].id, "multiple", false, [q.options[1].id]), [q.options[0].id]);
  assert.equal(pollResponseError([q], [])?.startsWith("Answer"), true);
  assert.deepEqual(Object.keys(CreatePollRequestSchema.parse(payload(q))).sort(), ["ballotMode", "commandId", "intro", "questions", "title"]);
});

test("legacy choices remain valid and public results retain structured schedule", () => {
  const q = question();
  const legacy = { ...q, availability: undefined, options: [newPollOption("Friday"), newPollOption("Saturday")] };
  assert.equal(CreatePollRequestSchema.safeParse(payload(legacy)).success, true);
  const result = PublicPollSchema.parse({ id: crypto.randomUUID(), publicId: "123456789abc", event: { name: "Test", slug: "test" },
    title: "When?", intro: null, ballotMode: "transparent", status: "open", questions: [q], createdByName: "Organizer", responseCount: 0,
    resultsVisible: true, aggregates: [], createdAt: "2026-09-14T12:00:00Z" });
  assert.deepEqual(result.questions[0], q);
});
