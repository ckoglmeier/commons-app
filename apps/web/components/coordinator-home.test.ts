import test from "node:test";
import { readUnsent, writeUnsent } from "../lib/coordinator-unsent";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import type { CommonsParticipant, CommonsState, CommonsSummary } from "@commons/contracts";
import { coordinatorThreads, conversationDigestItems, messages } from "@commons/database";
import { createHookRenderer, registerComponentImportStubs, textOf } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { actAs, databaseTestsEnabled, eq, jsonRequest, params, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "../lib/server/coordinator-route-harness";

// Trip Home for organizers and travelers, and the group-message pause. Real components under the hook harness;
// the routes and database are real (disposable local Postgres); the model is a recording fake.
const skip = !databaseTestsEnabled;
registerComponentImportStubs();

const at = "2026-09-11T10:00:00.000Z";
const commonsSummary = (id: string): CommonsSummary => ({ id, slug: id, name: "Synthetic Breckenridge weekend", startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge, Colorado", timezone: "America/Denver", status: "planning", coverImageUrl: null });
const homeState = (id: string): CommonsState => ({
  commonsId: id, participation: {}, expenses: [], reimbursements: [], moments: [], processedCommandIds: [],
  messages: [
    { id: "m1", actorId: "robin", actorName: "Robin Synthetic", actorType: "human", body: "Anyone else hungry for fondue?", occurredAt: at, source: "web" },
    { id: "m2", actorId: "commons", actorName: "Commons", actorType: "commons", body: "Lodge dinner is on the plan.", occurredAt: at, source: "channel" },
  ],
  itinerary: [{ id: "plan-1", title: "Sunset sleigh ride", startsAt: "2027-02-13T22:00:00.000Z", status: "planned", participantScope: "everyone", provenanceLabel: "Added by Casey Synthetic" }],
  proposals: [{ id: "decision-1", title: "Dinner at Alpine Table", summary: "Saturday 5 PM", status: "approved", version: 1, createdAt: at, approvedAt: at, affectedPersonIds: [], evidence: [], payload: { kind: "shared_detail" } }],
  auditEvents: [{ id: "a1", commandId: "c1", actorId: "casey", targetId: "plan-1", occurredAt: at, action: "itinerary.added", summary: "x" }],
  pollRequests: [{ id: randomUUID(), publicId: "abcdef123456", title: "Which lodge night works?", status: "open", responded: false, canManage: false }],
} as unknown as CommonsState);
const participants = [{ id: "casey", displayName: "Casey Synthetic", role: "organizer" }, { id: "robin", displayName: "Robin Synthetic", role: "member" }] as unknown as CommonsParticipant[];

const treeText = (renderer: ReturnType<typeof createHookRenderer>) => renderer.tree.map(textOf).join("\n");
const noop = () => {};

async function mountHome(input: { eventId: string; actorId: string; organizer: boolean; voice?: boolean; conversationAvailable?: boolean; messagesEnabled?: boolean; main?: { threadId: string; turnVersion: number } }) {
  const [{ HomeDashboard }, { CoordinatorHomeEntry }, { EventConversation, OpenDecisions }, { AppRouterContext }] = await Promise.all([
    import("./home-dashboard"), import("./coordinator-home-entry"), import("./event-conversation"), import("next/dist/shared/lib/app-router-context.shared-runtime"),
  ]);
  const pushed: string[] = [];
  const router = { push: (href: string) => { pushed.push(href); }, replace: noop, refresh: noop, back: noop, forward: noop, prefetch: noop };
  const renderer = createHookRenderer({ expand: [HomeDashboard, CoordinatorHomeEntry, EventConversation, OpenDecisions], context: context => context === AppRouterContext ? router : undefined });
  const state = homeState(input.eventId), commons = commonsSummary(input.eventId);
  const conversation = createElement(EventConversation, { state, commons, participants, currentActorId: input.actorId, draft: "", setDraft: noop, send: async () => true, openActivity: noop, openProposal: noop, openMoments: noop, participation: {}, respond: async () => {}, messagesEnabled: input.messagesEnabled ?? false, attendance: createElement("section", { "aria-label": "Attendance" }, "Can you make Feb 12 to Feb 15?") });
  const coordinatorEntry = input.organizer ? createElement(CoordinatorHomeEntry, { slug: input.eventId, actorId: input.actorId, onContinue: () => pushed.push(`/c/${input.eventId}/coordinator`), ...(input.main ? { main: input.main } : {}) }) : undefined;
  renderer.render(createElement(HomeDashboard, { state, commons, participants, addTravelPlans: noop, currentActorId: input.actorId, activityParticipation: {}, addPlan: noop, addReceipt: noop, openProposal: noop, goToPlan: noop, goToMoney: noop, openTripDetails: noop, conversation, coordinatorEntry, openDecisions: createElement(OpenDecisions, { state, commons, openProposal: noop }) }));
  await settle(5); renderer.flush();
  const submit = () => (renderer.find(node => node.type === "button" && textOf(node) === "Use this draft in Coordinator").props.onClick as () => void)();
  return { renderer, pushed, submit, text: () => treeText(renderer), links: () => renderer.findAll(node => typeof node.props.href === "string").map(node => String(node.props.href)) };

}

async function withHomeScenario(run: (s: ScenarioContext, live: ReturnType<typeof installFakeLiveEnvironment>) => Promise<void>) {
  await withCoordinatorScenario(async s => {
    const live = installFakeLiveEnvironment({ liveFetch: (url, init) => s.network.fetch(url, init) });
    try { actAs(s.trip.organizerId); await run(s, live); } finally { live.restore(); }
  });
}

test("Organizer Trip page leaves Coordinator entry to the rail and makes no requests or model work", { skip }, () => withHomeScenario(async (s, live) => {
  const home = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.organizerId, organizer: true });
  try {
    assert.doesNotMatch(home.text(), /Talk to your coordinator/, "the rail owns the Coordinator entry");
    assert.match(home.text(), /What’s next/);
    assert.match(home.text(), /Open decisions/);
    assert.doesNotMatch(home.text(), /fondue|Lodge dinner is on the plan/);
    assert.match(home.text(), /Sunset sleigh ride/);
    assert.match(home.text(), /Dinner at Alpine Table/);
    assert.equal(home.renderer.findAll(node => node.type === "textarea").length, 0);
    assert.equal(s.network.records.length, 0);
    assert.equal(s.network.providerCalls.length, 0);
    assert.equal(live.liveRequests.length, 0);
    const created = await withTestDatabase(async db => db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, s.trip.eventId)));
    assert.equal(created.length, 0);
  } finally { home.renderer.unmount(); }
}));

test("Overview preserves a legacy draft until explicit recovery", { skip }, () => withHomeScenario(async s => {
  writeUnsent(s.trip.eventId, s.trip.organizerId, "overview", "A half-formed question about lodging");
  const home = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.organizerId, organizer: true, conversationAvailable: false });
  try {
    assert.match(home.text(), /Saved Trip-page draft/);
    assert.equal(home.renderer.findAll(node => node.type === "textarea").length, 0);
    assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, "overview"), "A half-formed question about lodging");
    home.submit();
    assert.equal(s.network.records.length, 0);
    assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, "new"), "A half-formed question about lodging");
  } finally { home.renderer.unmount(); }
}));

test("Participant enters Home or calls organizer APIs: shared state stays, coordinator access does not", { skip }, () => withHomeScenario(async (s, live) => {
  void live;
  const home = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.travelerId, organizer: false, voice: true });
  try {
    const text = home.text();
    assert.doesNotMatch(text, /Talk to your coordinator|coordinator/i, "no coordinator entry, voice or Workspace link for travelers");
    assert.equal(home.renderer.findAll(node => node.type === "textarea").length, 0, "and no group composer either");
    assert.match(text, /Open decisions/);
    assert.match(text, /Sunset sleigh ride/);
    assert.match(text, /Dinner at Alpine Table/);
    assert.match(text, /Can you make Feb 12 to Feb 15\?/);
    assert.match(text, /Which lodge night works\?/, "open decisions and polls remain");
  } finally { home.renderer.unmount(); }
  // Every organizer API refuses a traveler with the same stable code, saves nothing, and reveals nothing.
  const organizerThread = await s.post(s.command());
  assert.equal(organizerThread.status, 200);
  const threadId = organizerThread.body.thread.id as string;
  const before = await withTestDatabase(async db => (await db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, s.trip.eventId))).length);
  const blocked = await s.post(s.command(), s.trip.travelerId);
  assert.equal(blocked.status, 403);
  assert.equal(blocked.body.error.code, "organizer_required");
  const lookup = await s.lookup(organizerThread.body.commandId, s.trip.travelerId);
  assert.deepEqual([lookup.status, lookup.body.error.code], [403, "organizer_required"]);
  actAs(s.trip.travelerId);
  const at = (path: string, method: string, body?: unknown) => jsonRequest(s.trip.eventId, path, method, body);
  const read = await s.routes.turn.GET(new Request(`http://localhost/api/v1/commons/${s.trip.eventId}/coordinator?threadId=${threadId}`), params(s.trip.eventId));
  assert.equal(read.status, 403);
  assert.equal((await read.json()).code, "organizer_required");
  const create = await s.routes.threads.POST(at("/threads", "POST", { id: randomUUID(), commandId: randomUUID(), title: "Sneaky thread" }), params(s.trip.eventId));
  assert.equal(create.status, 403);
  const draft = await s.routes.drafts.POST(at("/drafts", "POST", { id: randomUUID(), prompt: "Ask the group something" }), params(s.trip.eventId));
  assert.equal(draft.status, 403);
  const legacy = await s.routes.turn.POST(at("", "POST", { commandId: randomUUID(), version: 0, threadId, prompt: "hello", draftId: null, draftVersion: null }), params(s.trip.eventId));
  assert.equal(legacy.status, 403);
  const after = await withTestDatabase(async db => (await db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, s.trip.eventId))).length);
  assert.equal(after, before, "no organizer record was created by a traveler");
  assert.equal(s.network.providerCalls.length, 1, "no model call was made for a traveler");
}));

const groupMessage = (body = "Anyone up for a late lunch?") => ({ commandId: randomUUID(), body, occurredAt: new Date().toISOString() });
async function messagesRoute() {
  registerComponentImportStubs();
  return import("../app/api/v1/commons/[slug]/messages/route");
}
const messageRows = (eventId: string) => withTestDatabase(async db => ({ sent: (await db.select().from(messages).where(eq(messages.commonsId, eventId))).length, queued: (await db.select().from(conversationDigestItems).where(eq(conversationDigestItems.commonsId, eventId))).length }));

test("Group messages flag: paused by default at the server boundary, and sends again when turned on", { skip }, () => withCoordinatorScenario(async s => {
  const route = await messagesRoute();
  const flag = process.env.COMMONS_GROUP_MESSAGES_ENABLED;
  try {
    const send = async (body = groupMessage()) => { actAs(s.trip.organizerId); return route.POST(new Request(`http://localhost/api/v1/commons/${s.trip.eventId}/messages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), params(s.trip.eventId)); };
    for (const value of [undefined, "false", "yes"]) {
      if (value === undefined) delete process.env.COMMONS_GROUP_MESSAGES_ENABLED; else process.env.COMMONS_GROUP_MESSAGES_ENABLED = value;
      const response = await send();
      assert.equal(response.status, 403, `flag ${value ?? "unset"}`);
      assert.deepEqual(await response.json(), { error: "Group messages are paused in Commons. Nothing was sent.", code: "group_messages_disabled" });
    }
    // Before any work: no sign-in is consulted, the body is not parsed, and nothing is queued.
    delete process.env.COMMONS_PILOT_ACTOR_ID;
    const unauthenticated = await route.POST(new Request("http://localhost/x", { method: "POST", body: "{not json" }), params(s.trip.eventId));
    assert.equal(unauthenticated.status, 403);
    assert.equal((await unauthenticated.json()).code, "group_messages_disabled");
    assert.deepEqual(await messageRows(s.trip.eventId), { sent: 0, queued: 0 }, "paused means no message and no message email");
    delete process.env.COMMONS_GROUP_MESSAGES_ENABLED;
    // The organizer coordinator keeps working while group messages are paused.
    const turn = await s.post(s.command());
    assert.equal(turn.status, 200, JSON.stringify(turn.body));
    assert.equal(turn.body.status, "completed");
    // Rolling back is one setting: the same request now sends and is stored.
    process.env.COMMONS_GROUP_MESSAGES_ENABLED = "true";
    const enabled = await send(groupMessage("Late lunch at 1?"));
    assert.equal(enabled.status, 200, JSON.stringify(await enabled.clone().json()));
    const body = await enabled.json();
    assert.deepEqual(body.snapshot.state.messages.map((message: { body: string }) => message.body), ["Late lunch at 1?"]);
    assert.equal((await messageRows(s.trip.eventId)).sent, 1);
    // Turning it off again hides nothing that was stored: the record stays and only the route and the UI close.
    delete process.env.COMMONS_GROUP_MESSAGES_ENABLED;
    assert.equal((await send()).status, 403);
    assert.equal((await messageRows(s.trip.eventId)).sent, 1, "records are preserved");
  } finally { if (flag === undefined) delete process.env.COMMONS_GROUP_MESSAGES_ENABLED; else process.env.COMMONS_GROUP_MESSAGES_ENABLED = flag; }
}));

test("Group messages flag: the Home conversation offers a composer and message entries only when turned on", { skip }, () => withHomeScenario(async s => {
  const off = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.organizerId, organizer: false, messagesEnabled: false });
  try {
    assert.equal(off.renderer.findAll(node => node.type === "textarea").length, 0);
    assert.doesNotMatch(off.text(), /Message the group|fondue/);
    assert.match(off.text(), /Sunset sleigh ride/);
  } finally { off.renderer.unmount(); }
  const on = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.organizerId, organizer: false, messagesEnabled: true });
  try {
    assert.equal(on.renderer.findAll(node => node.type === "textarea").length, 1);
    assert.match(on.text(), /Message the group/);
    assert.match(on.text(), /Anyone else hungry for fondue\?/);
    assert.match(on.text(), /Sunset sleigh ride/, "records show in both states");
  } finally { on.renderer.unmount(); }
}));

test("Overview transfers to the main conversation without relying on its turn version", { skip }, () => withHomeScenario(async s => {
  const main = { threadId: randomUUID(), turnVersion: 0 };
  writeUnsent(s.trip.eventId, s.trip.organizerId, "overview", "Saturday around 5 works for the group.");
  const home = await mountHome({ eventId: s.trip.eventId, actorId: s.trip.organizerId, organizer: true, main });
  try {
    home.submit();
    assert.deepEqual(home.pushed, [`/c/${s.trip.eventId}/coordinator`]);
    assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, `thread:${main.threadId}`), "Saturday around 5 works for the group.");
    assert.equal(s.network.records.length, 0);
    assert.equal(s.network.providerCalls.length, 0);
  } finally { home.renderer.unmount(); }
}));
