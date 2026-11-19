import assert from "node:assert/strict";
import test from "node:test";
import { CreatePollRequestSchema, PollWorkingDataSchema, type PollWorkingData } from "@commons/contracts";
import { buildPollFramingContext, POLL_FRAMING_PACKET_LIMIT, type PollFramingFacts } from "./poll-framing-context";

const id = (n: number) => `91000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const facts: PollFramingFacts = {
  trip: { title: "Lake weekend", startsOn: "2027-02-12", endsOn: "2027-02-15", place: "Estes Park", timezone: "America/Denver", currency: "USD", travelerCount: 6 },
  stays: [{ id: id(1), name: "Pine Cabin", startsOn: "2027-02-12", endsOn: "2027-02-15", status: "considering" }],
  activities: [{ id: id(2), title: "Snowshoe hike", startsAt: "2027-02-13T16:00:00.000Z", scheduledDate: null, timezone: "America/Denver", place: "Bear Lake", status: "planned" }],
};
const option = (optionId: string, label: string, description: string | null = null, resource: { type: "stay"; id: string } | null = null) => ({ id: optionId, label, description, exclusive: false, url: null, resource });
const draft = (questions: PollWorkingData["questions"]): Pick<PollWorkingData, "title" | "intro" | "questions"> => ({ title: "Weekend", intro: "Pick what you would do.", questions });
const question = { id: id(10), kind: "choice" as const, prompt: "Which would you do?", required: true, selectionMode: "multiple" as const,
  options: [option(id(2), "Snowshoe hike", "Estimated $40 each"), option(id(3), "Pine Cabin", null, { type: "stay", id: id(1) })] };

test("the packet carries permitted trip facts and local activity time, and never names, notes or codes", () => {
  // The facts type has no field for private data, so a planted value can only enter through an allowed field. Prove the packet adds nothing else.
  const planted = { ...facts, stays: [{ ...facts.stays[0], confirmationCode: "CONF-SECRET-123", address: "1 Private Lane" }], activities: [{ ...facts.activities[0], note: "PRIVATE-PLAN-NOTE" }], travelers: ["Private Traveler Name"], otherDrafts: ["OTHER-DRAFT-SECRET"] } as unknown as PollFramingFacts;
  const { packet, editableQuestionIds, suppliedOptionIds } = buildPollFramingContext(planted, draft([question]));
  const text = JSON.stringify(packet);
  for (const secret of ["CONF-SECRET-123", "1 Private Lane", "PRIVATE-PLAN-NOTE", "Private Traveler Name", "OTHER-DRAFT-SECRET"]) assert.ok(!text.includes(secret), secret);
  assert.equal(packet.trip.travelerCount, 6);
  assert.deepEqual(Object.keys(packet.trip).sort(), ["currency", "endsOn", "place", "startsOn", "timezone", "title", "travelerCount"]);
  const hike = packet.options.find(entry => entry.id === id(2));
  assert.equal(hike?.day, "Saturday 2027-02-13"); assert.equal(hike?.time, "9:00 AM"); assert.equal(hike?.place, "Bear Lake"); assert.equal(hike?.status, "planned");
  assert.equal(hike?.sharedDescription, "Estimated $40 each");
  assert.equal(packet.options.find(entry => entry.type === "stay")?.title, "Pine Cabin");
  assert.deepEqual(editableQuestionIds, [id(10)]);
  assert.ok(suppliedOptionIds.includes(id(2)) && suppliedOptionIds.includes(id(3)));
});

test("the packet stays within 6 KB, and a question that was cut is never reported as editable", () => {
  const many = Array.from({ length: 8 }, (_, index) => ({ ...question, id: id(100 + index), prompt: "Q".repeat(200),
    options: Array.from({ length: 12 }, (_, n) => option(id(200 + index * 20 + n), "Option label ".repeat(8), "Description text ".repeat(10))) }));
  const context = buildPollFramingContext(facts, draft(many));
  assert.ok(JSON.stringify(context.packet).length <= POLL_FRAMING_PACKET_LIMIT);
  const sent = new Set(context.packet.currentDraft?.questions.map(entry => entry.id));
  assert.ok(context.editableQuestionIds.every(editable => sent.has(editable)));
  assert.ok(context.editableQuestionIds.length < 8);
});

test("typed questions are left out of revision, an empty draft sends no currentDraft", () => {
  const typed = { id: id(11), kind: "choice" as const, prompt: "Which days?", required: true, selectionMode: "multiple" as const, availability: { kind: "dates" }, options: [] } as unknown as PollWorkingData["questions"][number];
  const context = buildPollFramingContext(facts, draft([typed, question]));
  assert.deepEqual(context.editableQuestionIds, [id(10)]);
  assert.deepEqual(context.packet.currentDraft?.otherQuestions, ["Which days?"]);
  assert.equal(buildPollFramingContext(facts, { title: "", intro: "", questions: [] }).packet.currentDraft, null);
});

test("the private framing request is a draft field and is not part of the published poll", () => {
  const data = PollWorkingDataSchema.parse({ title: "Weekend", intro: "Shared words", framingRequest: "PRIVATE-REQUEST-TEXT", settledFacts: "PRIVATE-FACTS", ballotMode: "transparent", questions: [{ ...question, options: question.options.map(option => Object.fromEntries(Object.entries(option).filter(([key]) => key !== "resource")) as typeof option) }] });
  assert.equal(data.framingRequest, "PRIVATE-REQUEST-TEXT");
  assert.equal(PollWorkingDataSchema.safeParse({ title: "Old", intro: null, ballotMode: "transparent", questions: [] }).success, true, "drafts without the field still load");
  // Publish normalizes the saved draft data through CreatePollRequestSchema.
  const published = CreatePollRequestSchema.parse({ ...data, commandId: id(50), audience: { personIds: [id(51)], guestEmails: [] } });
  assert.ok(!JSON.stringify(published).includes("PRIVATE-REQUEST-TEXT") && !JSON.stringify(published).includes("PRIVATE-FACTS"));
  assert.equal(PollWorkingDataSchema.safeParse({ ...data, framingRequest: "x".repeat(501) }).success, false);
});
