import assert from "node:assert/strict";
import test from "node:test";
import { pilotSnapshot } from "./pilot-fixture";

test("the test fixture uses fictional people throughout its shared data and attribution", () => {
  assert.doesNotMatch(JSON.stringify(pilotSnapshot), /@gmail\.com|Rivera/i);
  assert.equal(pilotSnapshot.currentActor.displayName, "Jordan Reed");
  const jordan = pilotSnapshot.participants.find(person => person.id === pilotSnapshot.currentActor.id)!;
  const casey = pilotSnapshot.participants.find(person => person.displayName === "Casey Reed")!;
  assert.equal(jordan.initials, "JR");
  assert.equal(jordan.role, "organizer");
  assert.equal(casey.initials, "CR");
  assert.equal(pilotSnapshot.participants.length, 8);

  const names = new Map(pilotSnapshot.participants.map(person => [person.id, person.displayName]));
  for (const message of pilotSnapshot.state.messages.filter(message => message.actorType === "human")) {
    assert.equal(message.actorName, names.get(message.actorId));
  }
  for (const expense of pilotSnapshot.state.expenses) {
    assert.equal(expense.paidByName, names.get(expense.paidByPersonId));
    expense.shares.forEach(share => assert.ok(names.has(share.personId)));
  }
  for (const moment of pilotSnapshot.state.moments) {
    assert.equal(moment.addedByName, names.get(moment.addedByPersonId!));
  }
});
