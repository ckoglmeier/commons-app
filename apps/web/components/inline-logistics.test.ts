import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PersonTravel } from "./person-travel";
import { EventLogisticsView } from "./event-logistics-view";
import type { CommonsSummary, Stay, TravelPlan } from "@commons/contracts";

test("dates/places and stays precede people on mobile and occupy the desktop right rail", async () => {
  const commons: CommonsSummary = { id: "event", slug: "event", name: "Winter weekend", startsOn: null, endsOn: null, locationName: "Mountain town", timezone: "America/Denver", status: "planning", coverImageUrl: null };
  const stays: Stay[] = [{ id: "stay", name: "Sample cabin", address: "123 Example St", startsOn: "2026-12-20", endsOn: "2026-12-23", status: "planned", includedPersonIds: [], sourceLabel: "Added by owner" }];
  const props = { commons, stays, participants: [], travelPlans: [], currentActorId: "owner", persistent: false, canManage: false, people: createElement("section", null, "People and travel"), editBasics() {}, addThing() {}, addMeal() {}, addStay() {}, editStay() {}, addTravel() {}, copyAddress() {} };
  const html = renderToStaticMarkup(createElement(EventLogisticsView, props));
  const side = html.slice(html.indexOf('<aside class="event-logistics-side">'), html.indexOf("</aside>"));
  assert.ok(side.indexOf("Dates and places") < side.indexOf("Sample cabin"));
  assert.ok(html.indexOf("Sample cabin") < html.indexOf('id="people-results-title"'));
  assert.doesNotMatch(side, /People and travel/);
  assert.doesNotMatch(html, /Edit dates and places|Add stay|Edit stay/);
  assert.match(html, /Viewing as a participant\. Only organizers can edit dates, places, and stays\./);
  const organizer = renderToStaticMarkup(createElement(EventLogisticsView, { ...props, canManage: true }));
  assert.match(organizer, /Edit dates and places/);
  assert.match(organizer, /Edit stay/);
  const sample = renderToStaticMarkup(createElement(EventLogisticsView, { ...props, canEditBasics: true }));
  assert.match(sample, /Edit dates and places/);
  assert.doesNotMatch(sample, /Add stay|Edit stay/);
  const empty = renderToStaticMarkup(createElement(EventLogisticsView, { ...props, commons: { ...commons, locationName: null }, stays: [], canManage: true }));
  assert.match(empty, /aria-label="Edit dates and places">Add details<\/button>/);
  const signedInMember = renderToStaticMarkup(createElement(EventLogisticsView, { ...props, participants: [{ id: "owner", displayName: "Sam", initials: "S", role: "member", membershipStatus: "active", avatarUrl: null }] }));
  assert.match(signedInMember, /Viewing as Sam\./);
  assert.doesNotMatch(signedInMember, /Edit dates and places|Edit stay/);
  const css = await readFile(new URL("./event-logistics.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 1100px\)[\s\S]*\.event-logistics-main \{ grid-column: 1; grid-row: 1; \}/);
  assert.match(css, /\.event-logistics-side \{ grid-column: 2; grid-row: 1; \}/);
});

test("sample basics editing is bounded to the public fixture and never posts a shared update", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  assert.match(app, /const previewBasics = dataMode === "demo" && initialSnapshot.commons.id === PUBLIC_DEMO_COMMONS_ID/);
  assert.match(app, /const canEditBasics = canManageTrip \|\| previewBasics/);
  assert.match(app, /Sample only\. Changes reset when you reload\./);
  assert.match(app, /endsOn < startsOn/);
  const save = app.slice(app.indexOf("async function saveTripDetails"), app.indexOf("async function saveMoneySettings"));
  const sample = save.slice(0, save.indexOf("const response = await fetch"));
  assert.match(sample, /if \(dataMode === "demo"\)/);
  assert.match(sample, /if \(!previewBasics\) throw/);
  assert.match(sample, /setCommonsSummary/);
  assert.match(sample, /return;/);
  assert.doesNotMatch(sample, /localStorage|fetch\(|trackProductEvent\(/);
  assert.match(save, /method: "PATCH"/);
});

test("inline editors reuse save boundaries without modal behavior", async () => {
  const app = await readFile(new URL("./commons-app.tsx", import.meta.url), "utf8");
  const inline = await readFile(new URL("./inline-editor.tsx", import.meta.url), "utf8");
  assert.match(app, /inline \? <InlineEditor>/);
  assert.equal((app.match(/role=\{inline \? undefined : "dialog"\}/g) ?? []).length, 3);
  assert.match(app, /\{travelEditor\}/);
  assert.match(app, /\{existingStayEditor\}/);
  assert.doesNotMatch(app, /inlineTravelEditing|editor=\{.*travelEditor/);
  assert.match(app, /Boolean\(sheet && !inlineLogisticsEditing\)/);
  assert.match(app, /<TripApplicationShell [^>]*inert=\{backgroundInert\}/);
  assert.doesNotMatch(app, /inert=\{sheet \|\| arrivalOpen/);
  assert.doesNotMatch(inline, /body.style|addEventListener|aria-modal|role="dialog"/);
  assert.match(inline, /trigger\?\.isConnected/);
});

test("People expands in context and keeps profile and access authority", async () => {
  const source = await readFile(new URL("./people-sheet.tsx", import.meta.url), "utf8");
  assert.match(source, /inline \? <div className="event-people-inline"/);
  assert.match(source, /renderPersonTravel\?\.\(person.id\)/);
  assert.match(source, /inline && editingId && person.invitation\?\.id === editingId \? personForm/);
  assert.match(source, /managedByPersonIds\?\.includes/);
  assert.match(source, /canManage && persistent/);
  assert.match(source, /Reload people/);
  assert.match(source, /Make .* an organizer\?/);
});

test("person travel separates viewing and editing and protects private evidence", async () => {
  const source = await readFile(new URL("./person-travel.tsx", import.meta.url), "utf8");
  assert.match(source, /visibleTravelForPerson\(plans, personId, actorId\)/);
  assert.match(source, /const owned = plan.personId === actorId/);
  assert.match(source, /owned \? <button/);
  assert.match(source, /canViewPrivate && plan.confirmationCode/);
  assert.match(source, /owned && plan.confirmationDocumentUrl/);
  assert.match(source, /canViewCost && plan.totalCents/);
  assert.match(source, /No shared plan/);
  assert.doesNotMatch(source, /not booked|missing booking|href=.*travel/);
});

test("rendered basic travel includes real routes/times but no private cost, code or upload", () => {
  const plan: TravelPlan = { id: "booking", personId: "owner", personIds: ["owner", "guest"], personName: "Alex", kind: "arrival", date: "2026-12-20", time: "14:35", route: "DEN → SNA", note: "PRIVATE NOTE", visibility: "basic", totalCents: 98765, confirmationCode: "PRIVATECODE", confirmationDocumentUrl: "/private-document", sourceLabel: "Alex added this" };
  const render = (actorId: string, travelPlan = plan) => renderToStaticMarkup(createElement(PersonTravel, { personId: "guest", actorId, participants: [], plans: [travelPlan], showEmpty: true, edit() {} }));
  const shared = render("other-organizer");
  assert.match(shared, /DEN → SNA/);
  assert.match(shared, /2:35 PM/);
  assert.doesNotMatch(shared, /PRIVATE|987\.65|private-document|Edit or share/);
  const companion = render("guest");
  assert.match(companion, /PRIVATECODE/);
  assert.doesNotMatch(companion, /private-document|Edit or share/);
  const owner = render("owner");
  assert.match(owner, /PRIVATECODE|987\.65/);
  assert.match(owner, /private-document/);
  assert.match(owner, /Edit or share/);
  assert.doesNotMatch(render("other-organizer", { ...plan, visibility: "private" }), /DEN → SNA|PRIVATE/);
});
