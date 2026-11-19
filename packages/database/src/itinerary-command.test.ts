import { AddItineraryItemCommandSchema, UpdateItineraryItemCommandSchema } from "@commons/contracts";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const validCommand = {
  commandId: "command-add-plan-1",
  title: "Backyard football",
  date: "2025-05-17",
  time: "14:00",
  location: "The house",
  participantScope: "everyone" as const,
  note: "Bring shoes",
  occurredAt: "2026-08-27T16:03:16.000Z",
};

test("accepts a complete shared plan", () => {
  const command = AddItineraryItemCommandSchema.parse(validCommand);
  assert.equal(command.title, "Backyard football");
  assert.equal(command.participantScope, "everyone");
});

test("specific people requires a nonempty group for both add and edit, independently of cost", () => {
  for (const schema of [AddItineraryItemCommandSchema, UpdateItineraryItemCommandSchema]) {
    assert.throws(() => schema.parse({ ...validCommand, participantScope: "subgroup" }));
    const result = schema.parse({ ...validCommand, participantScope: "subgroup", expectedParticipantIds: ["adult", "managed"] });
    assert.deepEqual(result.expectedParticipantIds, ["adult", "managed"]);
    assert.equal(result.expectedCostCents, null);
  }
});

test("arranger is optional and explicit changes require the previous assignment", () => {
  const id = "10000000-0000-4000-8000-000000000001";
  assert.equal(AddItineraryItemCommandSchema.parse(validCommand).arrangerPersonId, undefined);
  assert.equal(AddItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: id }).arrangerPersonId, id);
  assert.equal(UpdateItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: null, expectedArrangerPersonId: id }).arrangerPersonId, null);
  assert.equal(UpdateItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: id, expectedArrangerPersonId: null }).expectedArrangerPersonId, null);
  assert.throws(() => UpdateItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: id }));
  assert.throws(() => UpdateItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: null }));
  assert.throws(() => AddItineraryItemCommandSchema.parse({ ...validCommand, arrangerPersonId: "commons" }));
});

test("accepts Just me for creating and editing without requiring client-supplied identity", () => {
  for (const schema of [AddItineraryItemCommandSchema, UpdateItineraryItemCommandSchema]) {
    const command = schema.parse({ ...validCommand, participantScope: "self", expectedCostCents: 27_500, expectedCostBasis: "per_person" });
    assert.equal(command.participantScope, "self");
    assert.deepEqual(command.expectedParticipantIds, []);
  }
});

test("accepts an undated idea as shared plan state", () => {
  const command = AddItineraryItemCommandSchema.parse({
    ...validCommand,
    title: "Fly fishing lesson",
    date: null,
    time: null,
  });
  assert.equal(command.date, null);
  assert.equal(command.time, null);
});

test("accepts a source link without requiring one for manual plans", () => {
  const linked = AddItineraryItemCommandSchema.parse({
    ...validCommand,
    sourceUrl: "https://www.alltrails.com/trail/us/colorado/royal-arch-trail",
  });
  assert.equal(linked.sourceUrl, "https://www.alltrails.com/trail/us/colorado/royal-arch-trail");
  assert.equal(AddItineraryItemCommandSchema.parse(validCommand).sourceUrl, undefined);
  assert.throws(() => AddItineraryItemCommandSchema.parse({ ...validCommand, sourceUrl: "javascript:alert(1)" }));
});

test("accepts an optional estimated cost on a plan", () => {
  const command = AddItineraryItemCommandSchema.parse({
    ...validCommand,
    expectedCostCents: 24_500,
  });
  assert.equal(command.expectedCostCents, 24_500);
  assert.throws(() => AddItineraryItemCommandSchema.parse({
    ...validCommand,
    expectedCostCents: 0,
  }));
});

test("accepts a per-person estimate with expected travelers", () => {
  const command = AddItineraryItemCommandSchema.parse({
    ...validCommand,
    expectedCostCents: 7_500,
    expectedCostBasis: "per_person",
    expectedParticipantIds: ["person-a", "person-b"],
  });
  assert.equal(command.expectedCostBasis, "per_person");
  assert.deepEqual(command.expectedParticipantIds, ["person-a", "person-b"]);
  assert.throws(() => AddItineraryItemCommandSchema.parse({
    ...validCommand,
    expectedCostCents: 7_500,
    expectedCostBasis: "per_person",
    expectedParticipantIds: [],
  }));
});

test("allows a day without time, rejects a time without day", () => {
  assert.throws(() => AddItineraryItemCommandSchema.parse({
    ...validCommand,
    date: null,
  }));
  assert.equal(AddItineraryItemCommandSchema.parse({...validCommand,time:null}).time,null);
});

test("rejects an invalid plan date or time", () => {
  assert.throws(() => AddItineraryItemCommandSchema.parse({
    ...validCommand,
    date: "Saturday",
    time: "2 PM",
  }));
});

test("records direct plan additions through the command boundary", async () => {
  const repository = await readFile(new URL("./pilot-repository.ts", import.meta.url), "utf8");
  assert.match(repository, /export async function addCommonsItineraryItem/);
  assert.match(repository, /insert\(itineraryItems\)/);
  assert.match(repository, /action: "itinerary\.added"/);
  assert.match(repository, /processedCommands/);
  assert.match(repository, /status: command.status \?\?/);
});
