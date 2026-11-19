import assert from "node:assert/strict";
import test from "node:test";
import { StaySchema } from "@commons/contracts";
import { pilotSnapshot } from "./pilot-fixture";
import { appendPublicDemoStay, publicDemoStays } from "./public-demo-stays";

test("the original sample house is editable without waiting for an additional stay", () => {
  const stays = publicDemoStays(pilotSnapshot.commons, pilotSnapshot.participants, []);
  assert.equal(stays.length, 1);
  assert.equal(StaySchema.parse(stays[0]).name, pilotSnapshot.commons.lodging?.name);
  assert.equal(publicDemoStays(pilotSnapshot.commons, pilotSnapshot.participants, stays).length, 1);
  assert.throws(() => publicDemoStays({ ...pilotSnapshot.commons, id: "real-event" }, [], []));
});

test("adding more housing preserves the original demo house and every additional stay", () => {
  const { commons, participants } = pilotSnapshot;
  const added = StaySchema.parse({ id: "second", name: "Sample second stay", address: "123 Example Road", startsOn: commons.startsOn, endsOn: commons.endsOn, status: "planned", includedPersonIds: [participants[0].id], sourceLabel: "Sample" });
  const two = appendPublicDemoStay(commons, participants, [], added);
  assert.equal(two.length, 2);
  assert.equal(two[0].name, commons.lodging?.name);
  two.forEach(stay => StaySchema.parse(stay));
  const three = appendPublicDemoStay(commons, participants, two, { ...added, id: "third" });
  assert.equal(three.length, 3);
  assert.equal(two.length, 2);
  assert.equal(three.filter(stay => stay.name === commons.lodging?.name).length, 1);
  assert.throws(() => appendPublicDemoStay({ ...commons, id: "real-event" }, participants, [], added));
});
