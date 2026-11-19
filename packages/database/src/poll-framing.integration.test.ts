import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommandAccessError, CommandConflictError } from "./event-command";
import { completePollFraming, PollFramingInFlightError, PollInferenceLimitError, reservePollFraming } from "./poll-inference-repository";
import { saveCommonsPollDraft } from "./poll-draft-repository";
import { commons, itineraryItems, memberships, people, stays } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

async function fixture() {
  const url = process.env.TEST_DATABASE_URL;
  assert.ok(url, "An explicit TEST_DATABASE_URL is required.");
  const database = createDatabase(url);
  const org = randomUUID(), member = randomUUID(), event = randomUUID(), stay = randomUUID(), shared = randomUUID(), subgroup = randomUUID();
  const slug = `framing-${event}`;
  await database.db.insert(people).values([{ id: org, displayName: "Olive Organizer", authUserId: randomUUID() }, { id: member, displayName: "Private Traveler Name", authUserId: randomUUID() }]);
  await database.db.insert(commons).values({ id: event, slug, name: "Lake weekend", timezone: "America/Denver", locationName: "Estes Park", currency: "USD", startsOn: "2027-02-12", endsOn: "2027-02-15", createdByPersonId: org });
  await database.db.insert(memberships).values([{ commonsId: event, personId: org, role: "organizer", status: "active" }, { commonsId: event, personId: member, role: "member", status: "active" }]);
  await database.db.insert(stays).values({ id: stay, commonsId: event, createdByPersonId: org, name: "Pine Cabin", address: "1 Private Lane", startsOn: "2027-02-12", endsOn: "2027-02-15", sourceLabel: "Synthetic", confirmationCode: "CONF-SECRET-123", details: "private door code 4455" });
  await database.db.insert(itineraryItems).values([
    { id: shared, commonsId: event, title: "Snowshoe hike", startsAt: new Date("2027-02-13T16:00:00Z"), timezone: "America/Denver", audience: "everyone", status: "planned", locationName: "Bear Lake", note: "PRIVATE-PLAN-NOTE", provenanceLabel: "Synthetic" },
    { id: subgroup, commonsId: event, title: "Surprise dinner", startsAt: new Date("2027-02-13T20:00:00Z"), timezone: "America/Denver", audience: "subgroup", status: "planned", provenanceLabel: "Synthetic" },
  ]);
  const options = { databaseUrl: url, actorPersonId: org };
  const choice = (id: string, label: string, resource?: { type: "stay"; id: string }) => ({ id, label, description: null, exclusive: false, url: null, resource: resource ?? null });
  const questions = [{ id: randomUUID(), kind: "choice" as const, prompt: "Which would you do?", required: true, selectionMode: "multiple" as const, options: [choice(shared, "Snowshoe hike"), choice(subgroup, "Surprise dinner"), choice(randomUUID(), "Pine Cabin", { type: "stay", id: stay })] }];
  const save = (data: Record<string, unknown>) => saveCommonsPollDraft(slug, { id: randomUUID(), commandId: randomUUID(), expectedVersion: 0, data: { title: "Weekend", intro: null, ballotMode: "transparent", questions, ...data } } as never, options);
  return { database, url, org, member, event, slug, options, save, shared, subgroup, stay,
    async close() { await database.db.delete(commons).where(inArray(commons.id, [event])); await database.db.delete(people).where(inArray(people.id, [org, member])); await database.close(); } };
}

test("framing reservation exposes only permitted trip facts, and a command id never reserves twice", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const other = await f.save({ title: "Other private draft", intro: "OTHER-DRAFT-SECRET", settledFacts: "x", questions: [] });
    const draft = await f.save({ framingRequest: "Help us pick between these two activities for Saturday", intro: "Pick what you would do.", settledFacts: "Saturday is fixed" });
    const commandId = randomUUID();
    const first = await reservePollFraming(f.slug, { draftId: draft.id, version: draft.version, commandId }, f.options);
    assert.equal(first.replay, false);
    if (first.replay) return;
    assert.equal(first.request, "Help us pick between these two activities for Saturday");
    assert.equal(first.facts.trip.travelerCount, 2);
    assert.equal(first.facts.trip.place, "Estes Park");
    assert.deepEqual(first.facts.stays.map(row => row.name), ["Pine Cabin"]);
    assert.deepEqual(first.facts.activities.map(row => row.title), ["Snowshoe hike"]);
    const packet = JSON.stringify(first.facts);
    for (const secret of ["Private Traveler Name", "Olive Organizer", "CONF-SECRET-123", "4455", "1 Private Lane", "PRIVATE-PLAN-NOTE", "Surprise dinner", "OTHER-DRAFT-SECRET"]) assert.ok(!packet.includes(secret), secret);
    await assert.rejects(reservePollFraming(f.slug, { draftId: draft.id, version: draft.version, commandId }, f.options), PollFramingInFlightError);
    await assert.rejects(reservePollFraming(f.slug, { draftId: draft.id, version: draft.version, commandId, change: "different" }, f.options), CommandConflictError);
    await assert.rejects(reservePollFraming(f.slug, { draftId: draft.id, version: draft.version, commandId }, { ...f.options, actorPersonId: f.member }), CommandAccessError);
    await completePollFraming(f.slug, { commandId }, { suggestion: { stored: true } }, f.options);
    const replay = await reservePollFraming(f.slug, { draftId: draft.id, version: draft.version, commandId }, f.options);
    assert.deepEqual(replay, { replay: true, result: { suggestion: { stored: true } } });
    await assert.rejects(reservePollFraming(f.slug, { draftId: draft.id, version: draft.version + 1, commandId: randomUUID() }, f.options), CommandConflictError);
    await assert.rejects(reservePollFraming(f.slug, { draftId: other.id, version: other.version, commandId: randomUUID() }, { ...f.options, actorPersonId: f.member }), CommandAccessError);
  } finally { await f.close(); }
});

test("legacy drafts without a private request use the introduction, and a free trip is capped per hour", { skip: !run }, async () => {
  const f = await fixture();
  try {
    const legacy = await f.save({ intro: "Choose a dinner time and place" });
    const reserved = await reservePollFraming(f.slug, { draftId: legacy.id, version: legacy.version, commandId: randomUUID() }, f.options, { hourlyCap: 3 });
    assert.ok(!reserved.replay && reserved.request === "Choose a dinner time and place");
    await reservePollFraming(f.slug, { draftId: legacy.id, version: legacy.version, commandId: randomUUID() }, f.options, { hourlyCap: 3 });
    await reservePollFraming(f.slug, { draftId: legacy.id, version: legacy.version, commandId: randomUUID() }, f.options, { hourlyCap: 3 });
    await assert.rejects(reservePollFraming(f.slug, { draftId: legacy.id, version: legacy.version, commandId: randomUUID() }, f.options, { hourlyCap: 3 }), PollInferenceLimitError);
    const empty = await f.save({ intro: null });
    await assert.rejects(reservePollFraming(f.slug, { draftId: empty.id, version: empty.version, commandId: randomUUID() }, f.options));
  } finally { await f.close(); }
});
