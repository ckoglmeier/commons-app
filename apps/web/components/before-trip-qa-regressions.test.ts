import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { CoordinatorThreadSchema, type AttendanceRunDetail, type ItineraryImportReceipt } from "@commons/contracts";
import { syntheticDraft } from "../../../packages/contracts/src/fixtures/research-itinerary";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";

registerComponentImportStubs();

for (const audience of ["link", "invitees", null] as const) test(`recorded attendance only counts unanswered for a known audience (${audience})`, async () => {
  const { AttendanceOutcome } = await import("./recipe-attendance");
  const trip = { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] };
  const run: AttendanceRunDetail = { id: randomUUID(), recipe: "attendance", title: "Attendance", stage: "decided", workflow: { key: "attendance", version: 1 },
    draft: { id: randomUUID(), version: 1, published: true, archived: false }, notes: [], evidenceFingerprint: null, trip, askedTrip: trip, headcount: null, history: [], summary: null, people: [],
    poll: audience ? { id: randomUUID(), publicId: "abcdef123456", status: "closed", responseCount: 3, superseded: false, audienceKind: audience, ballotMode: "transparent" } : null, outcome: {
    id: randomUUID(), status: "approved", base: trip, approvedAt: new Date().toISOString(), appliedAt: null, appliedTargets: null,
    approvedByName: "Casey", stale: [], result: { kind: "attendance", counts: { in: 2, maybe: 1, out: 0, unanswered: 0 }, people: [{ personId: randomUUID(), name: "Morgan", state: "in", partySize: 1, source: "organizer_entered", enteredBy: "Casey", note: "Told Casey in person" }],
      headcount: { in: 3, maybe: 1 }, excludedResponses: 0, exceptions: [], basedOn: { startsOn: "2027-04-15", endsOn: "2027-04-17", locationNames: ["Napa"] } },
  } };
  const renderer = createHookRenderer({ expand: [AttendanceOutcome] });
  try {
    renderer.render(createElement(AttendanceOutcome, { run, slug: "synthetic", busy: false, act: async () => {}, call: async () => ({ ok: false as const, error: "Read only" }), runBase: "unused" }));
    const text = renderer.tree.map(textOf).join(" ");
    assert.match(text, /2 in · 1 maybe · 0 out/);
    assert.match(text, /Includes organizer notes, not additional poll responses/);
    assert.match(text, /Morgan/);
    assert.match(text, /Added by Casey/);
    assert.match(text, /Told Casey in person/);
    if (audience === "invitees") assert.match(text, /0 not answered/);
    else { assert.doesNotMatch(text, /not answered/); assert.match(text, /can’t say who is still to answer/); }
  } finally { renderer.unmount(); }
});

for (const interruption of ["none", "close-before-receipt", "close-during-reload", "overview", "other-artifact"] as const) test(`import from a selected published poll opens its saved itinerary, respecting ${interruption}`, async () => {
  const document = syntheticDraft(), pollId = randomUUID(), at = new Date().toISOString();
  const initial = CoordinatorThreadSchema.parse({ version: 0, activeThreadId: document.threadId, hasEarlier: false, turns: [], drafts: [],
    threads: [{ id: document.threadId, title: "Coordinator", status: "active", version: 1, createdByPersonId: document.ownerId, createdByName: "Casey", turnCount: 0, draftCount: 0, pollCount: 1, archivedAt: null, createdAt: at, updatedAt: at }],
    polls: [{ id: pollId, threadId: document.threadId, publicId: "abcdef123456", title: "Dinner", status: "open", createdAt: at, audienceRestricted: false, responseCount: 0, resultsVisible: false, results: [] }],
  });
  const next = CoordinatorThreadSchema.parse({ ...initial, version: 1, turns: [{ id: randomUUID(), sequence: 1, threadId: document.threadId, userText: "Imported itinerary", assistantText: "Saved private itinerary", draftId: null, createdAt: at, workspace: { itineraryDraft: document } }] });
  let release = () => {};
  const pending = new Promise<void>(resolve => { release = resolve; });
  const live = installFakeLiveEnvironment({ liveFetch: async () => { await pending; return Response.json(next); } });
  window.history.pushState = (_data, _unused, url) => { const parsed = new URL(String(url), "http://localhost"); Object.assign(window.location, { pathname: parsed.pathname, search: parsed.search }); };
  const { CoordinatorWorkspace } = await import("./coordinator-workspace");
  const { CoordinatorItinerary } = await import("./coordinator-itinerary");
  const { ItineraryPortabilityPanel } = await import("./itinerary-portability-panel");
  const { AppRouterContext } = await import("next/dist/shared/lib/app-router-context.shared-runtime");
  const renderer = createHookRenderer({ expand: [CoordinatorWorkspace], context: c => c === AppRouterContext ? { push() {}, replace() {}, refresh() {} } : undefined });
  const props = { slug: randomUUID(), actorId: document.ownerId, eventName: "Synthetic", initialThread: initial, initialPollId: pollId, initialRecommendations: [], conversationAvailable: true, portabilityEnabled: true, embedded: true };
  const render = (patch = {}) => { renderer.render(createElement(CoordinatorWorkspace, { ...props, ...patch })); renderer.flush(); };
  const close = () => { (renderer.find(node => node.props["aria-label"] === "Close working material").props.onClick as () => void)(); renderer.flush(); };
  try {
    render(); await settle(5); renderer.flush();
    (renderer.find(node => node.type === "button" && textOf(node) === "Import an itinerary").props.onClick as (event: unknown) => void)({ currentTarget: { closest: () => null } }); renderer.flush();
    const apply = (renderer.find(node => node.type === ItineraryPortabilityPanel).props.onApplyStart as () => (receipt: ItineraryImportReceipt) => Promise<void>)();
    if (interruption === "close-before-receipt") close();
    const saving = apply({ threadId: document.threadId, documentId: document.id, version: 1, revisionCommandId: null, applied: 1, replayed: false });
    if (interruption === "close-during-reload") close();
    if (interruption === "overview") render({ active: false, showOverview: true });
    if (interruption === "other-artifact") { render({ navigation: { selected: `thread:${document.threadId}`, revision: 1 } }); await settle(5); renderer.flush(); }
    release(); await saving; await settle(5); renderer.flush();
    const work = renderer.find(node => node.props["aria-label"] === "Working material");
    if (interruption === "none") {
      assert.equal(work.props.hidden, false);
      assert.equal((renderer.find(node => node.type === CoordinatorItinerary).props.draft as typeof document).id, document.id);
      assert.equal(renderer.findAll(node => node.type === ItineraryPortabilityPanel).length, 0);
      assert.match(window.location.search, new RegExp(`itinerary=${document.id}`));
    } else {
      assert.equal(work.props.hidden, true, "late import cannot reopen Work");
      assert.doesNotMatch(window.location.search, new RegExp(`itinerary=${document.id}`));
    }
  } finally { release(); renderer.unmount(); live.restore(); }
});
