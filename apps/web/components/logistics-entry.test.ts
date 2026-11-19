import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { registerComponentImportStubs } from "../lib/test-support/hook-harness";
import { EventLogisticsView } from "./event-logistics-view";
import { shareStayAddress } from "./stay-address-actions";
import { pilotSnapshot } from "@/lib/pilot-fixture";
import { publicDemoStays } from "@/lib/public-demo-stays";

registerComponentImportStubs();

test("each travel type has a focused modal with no cross-type tabs or record list", async () => {
  const { TravelPlansSheet } = await import("./commons-app");
  const props = {
    commonsSlug: "sample", defaultDate: "2027-07-18", returnDefaultDate: "2027-07-25",
    plans: [], allPlans: [], participants: pilotSnapshot.participants,
    currentActorId: pilotSnapshot.currentActor.id, currentActorName: "Sample owner",
    close() {}, async save() {}, async saveBooking() {}, async updateSharing() {}, async remove() {},
    confirmationUploadEnabled: false, selectedRentalPlanId: "",
  };
  const flight = renderToStaticMarkup(createElement(TravelPlansSheet, { ...props, kind: "arrival" }));
  const rental = renderToStaticMarkup(createElement(TravelPlansSheet, { ...props, kind: "car_rental" }));
  for (const html of [flight, rental]) {
    assert.match(html, /role="dialog" aria-modal="true"/);
    assert.doesNotMatch(html, /role="tablist"|role="tab"|travel-plan-list|Add your plan/);
    assert.match(html, /confirmation numbers.*stay private/i);
  }
  assert.match(flight, /Add.*flights/);
  assert.match(flight, /Flight there/);
  assert.match(flight, /Add flight home/);
  assert.doesNotMatch(flight, /Rental company|Driver|Total cost|Total travel cost|Change sharing|Make private/);
  assert.match(flight, /Add flight costs separately as an expense in Money/);
  assert.match(rental, /Provider/);
  assert.match(rental, /Included travelers/);
  assert.match(rental, /Return date/);
  assert.doesNotMatch(rental, /Flights in this booking|Flight home/);
});

test("Add and Edit share focused modals, and trip facts open in their own Trip settings sheet", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  // Travel no longer repeats dates and places; Trip settings owns them.
  assert.match(app, /const inlineLogisticsEditing = false;/);
  assert.match(app, /<TripDetailsEditorSheet [^>]*inline=\{false\}/);
  assert.doesNotMatch(app, /inlineTravelEditing|stayEditor=\{existingStayEditor\}/);
  assert.match(app, /const existingStayEditor =[^\n]*<StayEditorSheet sampleOnly/);
  assert.match(app, /\{existingStayEditor\}/);
  assert.match(app, /setSheet\(kind === "flight" \? "add-flight" : "add-rental"\)/);
  assert.match(app, /const newStayEditor =[^\n]*<StayEditorSheet sampleOnly/);
  assert.match(app, /\{newStayEditor\}/);
  const modal = await readFile(new URL("./modal-layer.tsx", import.meta.url), "utf8");
  assert.match(modal, /select:not\(:disabled\), textarea:not\(:disabled\)/);
});

test("each stay exposes address actions and a separate organizer edit action", () => {
  const stays = publicDemoStays(pilotSnapshot.commons, pilotSnapshot.participants, []);
  const props = { commons: pilotSnapshot.commons, stays, participants: pilotSnapshot.participants, travelPlans: [],
    currentActorId: pilotSnapshot.currentActor.id, persistent: false, canManage: true, people: null,
    editBasics() {}, addThing() {}, addMeal() {}, addStay() {}, editStay() {}, addTravel() {}, copyAddress() {} };
  const organizer = renderToStaticMarkup(createElement(EventLogisticsView, props));
  const member = renderToStaticMarkup(createElement(EventLogisticsView, { ...props, canManage: false }));
  for (const html of [organizer, member]) {
    assert.match(html, /Copy address/);
    assert.match(html, /Share address/);
    assert.match(html, /google.com\/maps\/search\/\?api=1/);
    assert.doesNotMatch(html, /maps\/dir/);
  }
  assert.match(organizer, /aria-label="Edit stay: Falmouth Heights house"/);
  assert.doesNotMatch(member, /Edit stay:/);
  assert.ok(organizer.indexOf("Edit stay:") > organizer.indexOf("</details>"));
  const summary = organizer.slice(organizer.indexOf('<details class="event-stay-details">'), organizer.indexOf('</summary>'));
  assert.doesNotMatch(summary, /<svg/);
});

test("address sharing uses only the chosen address, with copy fallback but no copy on cancel", async () => {
  const copied: string[] = [];
  const shared: ShareData[] = [];
  const copy = (address: string) => { copied.push(address); };
  await shareStayAddress("Sample house", "123 Example Road", { copy, share: async data => { shared.push(data); } });
  assert.deepEqual(shared, [{ title: "Sample house", text: "Sample house\n123 Example Road" }]);
  assert.deepEqual(copied, []);
  await shareStayAddress("Sample house", "123 Example Road", { copy });
  await shareStayAddress("Other house", "456 Example Road", { copy, share: async () => { throw new Error("Unavailable"); } });
  await shareStayAddress("Cancelled", "Do not copy", { copy, share: async () => { throw new DOMException("Cancelled", "AbortError"); } });
  assert.deepEqual(copied, ["123 Example Road", "456 Example Road"]);
});

test("roster counts reset every item's inherited spacing and share the section type scale", async () => {
  const css = await readFile(new URL("./event-logistics.css", import.meta.url), "utf8");
  assert.match(css, /\.people-inline-section \.people-counts > span \{[^}]*align-items: baseline; padding: 0; border: 0;/);
  assert.doesNotMatch(css, /\.people-counts > span \+ span/);
  assert.match(css, /\.event-logistics-heading h3[^}]*var\(--cm-text-section\)[^}]*var\(--cm-font-editorial\)/);
});
