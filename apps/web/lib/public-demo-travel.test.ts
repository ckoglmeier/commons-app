import assert from "node:assert/strict";
import test from "node:test";
import { TravelPlanSchema } from "@commons/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pilotSnapshot } from "./pilot-fixture";
import { publicDemoTravelPlans } from "./public-demo-travel";
import { PersonTravel } from "../components/person-travel";

test("the demo shows a person with no shared flight details beside a reviewable rental", () => {
  const { commons, participants, currentActor } = pilotSnapshot;
  const plans = publicDemoTravelPlans(commons, participants);
  plans.forEach(plan => TravelPlanSchema.parse(plan));
  const withoutFlights = participants.find(person => person.displayName === "Casey Reed")!;
  const owner = participants.find(person => person.displayName === "Jordan Reed")!;
  assert.equal(plans.length, 9);
  assert.doesNotMatch(JSON.stringify(plans), /Casey|Robin|Rivera/i);
  const render = (personId: string) => renderToStaticMarkup(createElement(PersonTravel, { personId, actorId: currentActor.id, participants, plans, showEmpty: true, edit() {} }));
  assert.equal((render(withoutFlights.id).match(/No shared plan/g) ?? []).length, 3);
  assert.doesNotMatch(render(withoutFlights.id), /Delta|National|not booked/);
  const rental = plans.find(plan => plan.kind === "car_rental")!;
  assert.equal(rental.personId, owner.id);
  assert.equal(rental.returnDate, commons.endsOn);
  assert.match(render(owner.id), /National.*Standard SUV/);
  assert.match(render(owner.id), /Pick-up.*12:00 PM/);
  assert.match(render(owner.id), /Return.*10:30 AM/);
  assert.match(render(owner.id), /Sample rental|Edit or share rental/);
  assert.match(render(owner.id), /Jordan/);
  assert.doesNotMatch(render(owner.id), /Casey|Robin|Rivera/i);
});

test("demo travel never seeds another event or invents dates", () => {
  assert.deepEqual(publicDemoTravelPlans({ ...pilotSnapshot.commons, id: "another-event" }, pilotSnapshot.participants), []);
  assert.deepEqual(publicDemoTravelPlans({ ...pilotSnapshot.commons, startsOn: null }, pilotSnapshot.participants), []);
  assert.deepEqual(publicDemoTravelPlans({ ...pilotSnapshot.commons, endsOn: null }, pilotSnapshot.participants), []);
  assert.deepEqual(publicDemoTravelPlans(pilotSnapshot.commons, []), []);
});
