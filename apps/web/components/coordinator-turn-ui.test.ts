import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { ItineraryDraftSchema, CoordinatorThreadSchema, coordinatorError, coordinatorErrorCatalog, CoordinatorErrorCodeSchema, type CoordinatorErrorCode } from "@commons/contracts";
import { coordinatorThreads, coordinatorTurns, memberships, pollDrafts, polls, stays, createCommonsPoll } from "@commons/database";
import { createHookRenderer, registerComponentImportStubs, textOf, type HostNode, type OpaqueNode } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle } from "../lib/test-support/fake-live-transport";
import { actAs, databaseTestsEnabled, eq, params, withCoordinatorScenario, withTestDatabase, type ScenarioContext } from "../lib/server/coordinator-route-harness";
import { recoveryTiming } from "../lib/coordinator-client";
import { readUnsent, writeUnsent } from "../lib/coordinator-unsent";
// Goals are on by default; these cases cover the Coordinator paths without them.
process.env.COMMONS_COORDINATOR_GOALS_ENABLED = "false";

// Behavioral tests of the organizer Workspace against the turn contract (design §16.7). The real CoordinatorWorkspace and voice
// dialog run under the hook harness; their fetches reach the real route handlers and the disposable local database; the model,
// public search and WebRTC are fakes, and network faults are injected at the fetch boundary. Names follow the acceptance scenarios.
const skip = !databaseTestsEnabled;
registerComponentImportStubs();

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
type Request = { method: string; path: string; body: Body | null };
type Interceptor = (url: URL, init: RequestInit | undefined, pass: () => Promise<Response>) => Promise<Response> | undefined;

const byLabel = (label: string) => (node: HostNode | OpaqueNode) => node.props["aria-label"] === label;
const jsonResponse = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const isTurnPost = (request: Request) => request.method === "POST" && request.path === "/turns";

async function startThread(s: ScenarioContext, title: string, text = "Where should we eat on Saturday?", reply = "Try the early seating near your stay.") {
  Object.assign(s.next, { title, reply, summary: "Leaning toward an early dinner near the stay." });
  const result = await s.post(s.command({ text }));
  assert.equal(result.body.status, "completed", JSON.stringify(result.body));
  return { id: result.body.thread.id as string, title: result.body.thread.title as string, turnVersion: result.body.thread.turnVersion as number };
}

async function withUi(run: (s: ScenarioContext, ui: Awaited<ReturnType<typeof kit>>) => Promise<void>, options: { analytics?: boolean; environment?: Record<string, string> } = {}) {
  const timing = { ...recoveryTiming };
  recoveryTiming.pollMs = 5; recoveryTiming.missingRetryMs = 5;
  const { voiceTiming } = await import("./coordinator-live-conversation");
  const voiceTimings = { ...voiceTiming };
  Object.assign(voiceTiming, { transcriptSettleMs: 5, closeWaitMs: 30, respondingIdleMs: 25, announceSettleMs: 25 });
  try {
    await withCoordinatorScenario(async s => {
      const ui = await kit(s, options);
      try { actAs(s.trip.organizerId); await run(s, ui); await ui.quiet(); } finally { ui.cleanup(); }
    }, { environment: options.environment });
  } finally { Object.assign(recoveryTiming, timing); Object.assign(voiceTiming, voiceTimings); }
}

async function kit(s: ScenarioContext, options: { analytics?: boolean } = {}) {
  const [{ CoordinatorWorkspace, ProposalArtifact, TripChangeArtifact }, { CoordinatorLiveConversation }, parts, { AppRouterContext }] = await Promise.all([
    import("./coordinator-workspace"), import("./coordinator-live-conversation"), import("./coordinator-turn-parts"), import("next/dist/shared/lib/app-router-context.shared-runtime"),
  ]);
  const requests: Request[] = [];
  const analyticsEvents: Array<{ eventName: string; properties: Record<string, unknown> }> = [];
  const intercepts: Interceptor[] = [];
  let inFlight = 0;
  const live = installFakeLiveEnvironment({
    ...(options.analytics ? { pathname: `/c/${s.trip.eventId}/coordinator/` } : {}),
    liveFetch: async (url, init) => {
      inFlight += 1;
      try { return await handle(url, init); } finally { inFlight -= 1; }
    },
  });
  async function handle(url: string, init?: RequestInit) {
    const parsed = new URL(url, "http://localhost");
    if (parsed.pathname === "/api/v1/analytics/events") { analyticsEvents.push(JSON.parse(String(init?.body))); return jsonResponse({}, 201); }
    if (parsed.origin === "http://localhost") requests.push({ method: (init?.method ?? "GET").toUpperCase(), path: parsed.pathname.replace(/^.*\/coordinator/, "") + parsed.search, body: init?.body ? JSON.parse(String(init.body)) : null });
    const pass = () => s.network.fetch(url, init);
    for (const intercept of intercepts) { const handled = intercept(parsed, init, pass); if (handled) return handled; }
    return pass();
  }
  /** Lets requests and the work that follows them finish, so nothing runs after the fakes are removed (and a test never races a load). */
  async function quiet() { for (let calm = 0, waited = 0; calm < 3 && waited < 5_000; waited += 20) { await settle(20); calm = inFlight === 0 ? calm + 1 : 0; } }
  const mounted: Array<ReturnType<typeof createHookRenderer>> = [];
  const pushed: string[] = [];
  const router = { push: (href: string) => { pushed.push(href); }, replace() {}, refresh() {}, back() {}, forward() {}, prefetch() {} };
  const workspaceUrl = (threadId?: string) => `http://localhost/api/v1/commons/${s.trip.eventId}/coordinator${threadId ? `?threadId=${threadId}` : ""}`;

  async function mount(options: { threadId?: string; startNew?: boolean; startQuestion?: boolean; startVoice?: boolean; voice?: boolean; research?: boolean; activityDecisions?: boolean; pollEditor?: boolean; onAddRecord?: (kind: "flight"|"hotel"|"activity"|"meal"|"transport")=>void } = {}) {
    actAs(s.trip.organizerId);
    const initialThread = CoordinatorThreadSchema.parse(await (await s.routes.turn.GET(new globalThis.Request(workspaceUrl(options.threadId)), params(s.trip.eventId))).json());
    const [{ CoordinatorReview }, { CoordinatorShare }, { CoordinatorTripTask }] = await Promise.all([import("./coordinator-review"), import("./coordinator-share"), import("./coordinator-trip-task")]);
    const renderer = createHookRenderer({ expand: [...(options.pollEditor ? [CoordinatorReview, CoordinatorShare] : []), CoordinatorWorkspace, CoordinatorTripTask, CoordinatorLiveConversation, ProposalArtifact, TripChangeArtifact, parts.TurnFailed, parts.TurnPending, parts.ClarifyCandidates, parts.LiveTurn], context: context => context === AppRouterContext ? router : undefined });
    mounted.push(renderer);
    renderer.render(createElement(CoordinatorWorkspace, { slug: s.trip.eventId, actorId: s.trip.organizerId, actorName: "Casey Synthetic", eventName: "Synthetic Breckenridge weekend", initialThread, initialRecommendations: [], conversationAvailable: true,
      activityDecisionsEnabled: options.activityDecisions ?? false, onAddRecord: options.onAddRecord, voiceAvailable: options.voice ?? false, researchAvailable: options.research ?? false, startNew: options.startNew ?? false, startQuestion: options.startQuestion ?? false, startVoice: options.startVoice ?? false }));
    await settle(5); renderer.flush();
    const app = {
      renderer,
      text: () => renderer.tree.map(textOf).join("\n"),
      composer: () => renderer.find(byLabel("Message your coordinator")),
      value: () => String(renderer.find(byLabel("Message your coordinator")).props.value),
      destination: () => textOf(renderer.find(node => node.props.id === "workspace-destination")),
      type(value: string) { (app.composer().props.onChange as (event: unknown) => void)({ target: { value } }); renderer.flush(); },
      submit() { (renderer.find(node => node.type === "form" && node.props.className === "review-composer").props.onSubmit as (event: unknown) => void)({ preventDefault() {} }); },
      buttons: (label: string | RegExp) => renderer.findAll(node => node.type === "button" && (typeof label === "string" ? textOf(node).trim() === label : label.test(textOf(node)))),
      click(label: string | RegExp) { const [button] = app.buttons(label); assert.ok(button, `no button "${label}" in: ${app.text().slice(0, 600)}`); (button.props.onClick as () => void)(); renderer.flush(); },
      alert: () => renderer.findAll(node => node.props.role === "alert").map(textOf).join("\n"),
      async until(condition: () => boolean, what: string, ms = 5_000) {
        for (let waited = 0; waited < ms; waited += 10) { renderer.flush(); if (condition()) return; await settle(10); }
        renderer.flush();
        assert.ok(condition(), `timed out waiting for ${what}. Requests: ${JSON.stringify(requests.map(r => `${r.method} ${r.path}`))}. Text: ${app.text().slice(0, 800)}`);
      },
      async idle() { await quiet(); renderer.flush(); },
    };
    return app;
  }
  return {
    s, live, requests, pushed, mount, analyticsEvents,
    intercept(interceptor: Interceptor) { intercepts.push(interceptor); return () => { intercepts.splice(intercepts.indexOf(interceptor), 1); }; },
    turnPosts: () => requests.filter(isTurnPost),
    rows: () => withTestDatabase(async db => ({
      threads: await db.select().from(coordinatorThreads).where(eq(coordinatorThreads.commonsId, s.trip.eventId)),
      turns: await db.select().from(coordinatorTurns).where(eq(coordinatorTurns.commonsId, s.trip.eventId)),
      drafts: await db.select().from(pollDrafts).where(eq(pollDrafts.commonsId, s.trip.eventId)),
      polls: await db.select().from(polls).where(eq(polls.commonsId, s.trip.eventId)),
      stays: await db.select().from(stays).where(eq(stays.commonsId, s.trip.eventId)),
      members: await db.select().from(memberships).where(eq(memberships.commonsId, s.trip.eventId)),
    })),
    quiet,
    cleanup() { for (const renderer of mounted) renderer.unmount(); live.restore(); },
  };
}

test("Start a new text restaurant topic: an ordinary conversation, one named thread, one saved turn, no poll draft", { skip }, () => withUi(async (s, ui) => {
  const app = await ui.mount({ startNew: true });
  assert.equal(app.destination(), "To: New conversation");
  assert.match(app.text(), /What would you like to work on\?/);
  assert.match(app.text(), /Ask the group/);
  assert.match(app.text(), /Or ask the group:/, "Ask the group stays one explicit tap away");
  const typed = "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?";
  app.type(typed); app.submit();
  await app.until(() => app.destination() === "To: Saturday dinner", "the new thread to open with its generated title");
  const [post] = ui.turnPosts();
  assert.deepEqual([ui.turnPosts().length, post.body!.target.kind, post.body!.inputMode, post.body!.text, post.body!.explicitAction, post.body!.artifact], [1, "new", "text", typed, undefined, undefined]);
  assert.match(post.body!.target.threadId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(ui.requests.filter(request => request.method === "POST" && request.path !== "/turns"), [], "no thread or draft request: the first turn creates the thread");
  const rows = await ui.rows();
  assert.deepEqual([rows.threads.length, rows.turns.length, rows.drafts.length, rows.polls.length], [1, 1, 0, 0]);
  assert.equal(rows.threads[0].id, post.body!.target.threadId);
  assert.match(app.text(), /Try the early seating near your stay\./);
  assert.equal(app.value(), "", "sent text leaves the box once the turn is saved");
  assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, "new"), "");
  assert.match(JSON.stringify(s.network.providerCalls[0].body), /Synthetic Peak Lodge/, "the turn starts from the saved trip context");
}));

test("Request a poll explicitly: Ask the group sends ask_group through /turns, links the draft to its thread, and publishing stays separate", { skip }, () => withUi(async (s, ui) => {
  s.next.reply = "I've drafted a question for review.";
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which restaurant?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const app = await ui.mount({ startQuestion: true });
  assert.match(app.text(), /What are you trying to ask the group\?/);
  assert.equal(app.destination().startsWith("To: Ask the group"), true);
  app.type("Where should we eat on Saturday?"); app.submit();
  await app.until(() => app.buttons("Review poll").length === 1, "the saved private poll to appear");
  const [post] = ui.turnPosts();
  assert.deepEqual([post.body!.target.kind, post.body!.explicitAction], ["new", { kind: "ask_group", starterId: null }]);
  assert.deepEqual(ui.requests.filter(request => request.path === "/drafts" || request.path === "/threads"), [], "no separate draft or thread request");
  const before = await ui.rows();
  assert.deepEqual([before.threads.length, before.drafts.length, before.polls.length], [1, 1, 0]);
  assert.equal(before.drafts[0].threadId, before.threads[0].id, "the draft belongs to the thread that asked");
  assert.deepEqual([before.drafts[0].version, before.drafts[0].data.questions.length], [1, 1], "first construction saves generated questions into a private draft");
  assert.match(app.text(), /Nothing has been shared or sent/);
  assert.equal(app.buttons("Apply to draft").length, 0, "initial construction is ready to review without a redundant apply step");
  assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, false);
}));

test("Explicitly continue in lodging thread: the UI switches only from where it asked, labels the new place, and later turns attach there", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const app = await ui.mount({ threadId: dinner.id });
  assert.equal(app.destination(), "To: Saturday dinner");
  app.type("Continue this in lodging"); app.submit();
  await app.until(() => app.destination() === "To: Lodging costs", "the switch to lodging");
  assert.match(app.text(), /Lodging was booked earlier\./, "the lodging thread's own history is shown");
  assert.equal(app.value(), "", "the lodging thread has its own message box; the request text was sent, not moved");
  assert.equal(ui.turnPosts().length, 1);
  assert.equal(s.network.providerCalls.length, 2, "navigation itself is model-free");
  // Later turns attach to lodging with lodging's version, not the version of the thread the request came from.
  app.type("How much was the lodging total?"); app.submit();
  await app.until(() => ui.turnPosts().length === 2, "the second turn");
  const second = ui.turnPosts()[1].body!;
  assert.deepEqual([second.target.kind, second.target.threadId, second.target.expectedTurnVersion], ["existing", lodging.id, lodging.turnVersion]);
  await app.until(() => s.network.providerCalls.length === 3, "the answer");
  const rows = await ui.rows();
  assert.equal(rows.turns.filter(turn => turn.threadId === lodging.id).length, 2);
  const receipt = rows.turns.find(turn => turn.userText === "Continue this in lodging")!;
  assert.equal(receipt.threadId, dinner.id, "the receipt stays in the origin thread; nothing was moved");
}));

test("Two possible dinner threads: one clarification with a button per candidate; choosing one opens it without sending anything", { skip }, () => withUi(async (s, ui) => {
  const friday = await startThread(s, "Friday dinner", "Friday dinner ideas?");
  const saturday = await startThread(s, "Saturday dinner", "Saturday dinner ideas?");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const app = await ui.mount({ threadId: lodging.id });
  app.type("Open the dinner thread"); app.submit();
  await app.until(() => app.buttons("Friday dinner").length === 1 && app.buttons("Saturday dinner").length === 1, "both candidates as buttons");
  assert.match(app.text(), /Which one do you mean/);
  assert.match(app.text(), /I haven’t switched anything/);
  // F4: the clarification says once that nothing switched (in the answer) and once how to proceed (under the buttons), never the same thing twice.
  assert.equal((app.text().match(/switched/g) ?? []).length, 1, "nothing-switched is said once");
  assert.equal((app.text().match(/Choose one to open it\./g) ?? []).length, 1, "the instruction appears once");
  assert.doesNotMatch(app.text(), /Nothing has switched/);
  assert.equal(app.destination(), "To: Lodging costs", "no thread was picked for the organizer");
  assert.equal(s.network.providerCalls.length, 3, "no model call and no guess");
  const posts = ui.turnPosts().length;
  app.click("Saturday dinner");
  await app.until(() => app.destination() === "To: Saturday dinner", "the chosen thread to open");
  await app.until(() => /Saturday dinner ideas\?/.test(app.text()), "the chosen thread's history");
  assert.equal(ui.turnPosts().length, posts, "choosing a candidate is a client-side open, not a turn");
  assert.notEqual(saturday.id, friday.id);
}));

test("Late response attaches to its origin thread: navigating away neither steals focus nor loses the answer", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const app = await ui.mount({ threadId: dinner.id });
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  ui.intercept((url, init, pass) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? pass().then(async response => { await gate; return response; }) : undefined);
  s.next.reply = "LATE-ANSWER-FOR-DINNER";
  app.type("What time should we sit down?"); app.submit();
  await app.until(() => ui.turnPosts().length === 1, "the request to be on the wire");
  await settle(50);
  // The organizer moves on while the answer is still on its way.
  app.click(/Lodging costs/);
  await app.until(() => app.destination() === "To: Lodging costs", "navigation to lodging");
  assert.match(app.text(), /Commons is replying in Saturday dinner\. You can keep typing/, "the composer says where the pending message is going");
  assert.doesNotMatch(app.text(), /What time should we sit down\?/, "the live message stays in its origin thread, not the one on screen");
  release();
  await app.until(() => !app.text().includes("Commons is replying in Saturday dinner"), "the late result to settle without changing the visible conversation");
  await app.idle();
  assert.equal(app.destination(), "To: Lodging costs", "a late result never steals focus");
  assert.doesNotMatch(app.text(), /LATE-ANSWER-FOR-DINNER/, "and never lands in the thread being read");
  assert.match(app.text(), /Lodging was booked earlier\./);
  // Back at the origin the answer is there, and the next send carries the version that answer produced.
  app.click(/Saturday dinner/);
  await app.until(() => /LATE-ANSWER-FOR-DINNER/.test(app.text()), "the answer in its origin thread");
  assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, `thread:${dinner.id}`), "", "the sent text was cleared from its own thread");
  s.next.reply = "Second answer";
  app.type("And after dinner?"); app.submit();
  await app.until(() => ui.turnPosts().length === 2, "the follow-up");
  assert.deepEqual([ui.turnPosts()[1].body!.target.threadId, ui.turnPosts()[1].body!.target.expectedTurnVersion], [dinner.id, dinner.turnVersion + 1]);
  await app.until(() => /Second answer/.test(app.text()), "the follow-up answer");
  assert.equal((await ui.rows()).turns.filter(turn => turn.threadId === lodging.id).length, 1, "the lodging thread gained nothing");
}));

test("Timeout after server commit, then retry/reload: the outcome is looked up by command id and the exchange is saved once", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  // The server commits, then the connection drops before the browser hears back.
  let drop = true;
  // A streamed reply commits at the end of its stream, so "after commit" means after reading it to the end.
  ui.intercept((url, init, pass) => drop && init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? pass().then(async response => { await response.text(); drop = false; throw new TypeError("connection dropped after commit"); }) : undefined);
  s.next.reply = "Committed before the drop";
  app.type("Where should we eat?"); app.submit();
  await app.until(() => /Committed before the drop/.test(app.text()), "the saved answer found by lookup");
  const commandId = ui.turnPosts()[0].body!.commandId;
  assert.equal(ui.turnPosts().length, 1, "the browser never sent it a second time");
  assert.ok(ui.requests.some(request => request.method === "GET" && request.path === `/turns/${commandId}`), "it asked what happened to that command instead");
  const rows = await ui.rows();
  assert.equal(rows.turns.filter(turn => turn.userText === "Where should we eat?").length, 1, "one saved exchange");
  assert.equal(app.value(), "");
  assert.equal(app.alert(), "", "no error: the request had succeeded");
}));

test("Timeout after server commit, then retry/reload: when even the lookup is unreachable nothing is assumed, and Check again finds the saved exchange after a reload", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let offline = true, dropped = false;
  ui.intercept((url, init, pass) => {
    if (!offline) return undefined;
    // A streamed reply commits at the end of its stream, so "after commit" means after reading it to the end.
    if (init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") && !dropped) return pass().then(async response => { await response.text(); dropped = true; throw new TypeError("connection dropped after commit"); });
    if (url.pathname.includes("/coordinator/turns/")) return Promise.reject(new TypeError("still offline"));
    return undefined;
  });
  s.next.reply = "Saved while offline";
  app.type("Any late dinner options?"); app.submit();
  await app.until(() => /couldn’t confirm whether Commons received that/.test(app.alert()), "the honest unconfirmed message");
  assert.equal(app.value(), "Any late dinner options?", "the text stays, because nothing is known");
  assert.equal(app.buttons("Check again").length, 1);
  assert.equal(ui.turnPosts().length, 1, "and nothing is sent again on its own");
  // Reload while offline state persists: the command is remembered, and the page looks it up before doing anything else.
  const first = ui.turnPosts()[0].body!.commandId;
  app.renderer.unmount();
  offline = false;
  const reloaded = await ui.mount({ threadId: dinner.id });
  await reloaded.until(() => reloaded.value() === "" && /Saved while offline/.test(reloaded.text()), "the reloaded page to find the saved exchange");
  assert.equal(ui.turnPosts().length, 1, "reloading did not resend");
  assert.ok(ui.requests.some(request => request.method === "GET" && request.path === `/turns/${first}`));
  const rows = await ui.rows();
  assert.equal(rows.turns.filter(turn => turn.userText === "Any late dinner options?").length, 1);
  assert.equal(reloaded.alert(), "");
}));

test("Timeout after server commit, then retry/reload: a failed reply stays in the thread and Try again reuses the same command", { skip }, () => withUi(async (s, ui) => {
  let failing = true;
  ui.intercept(url => failing && (url.origin === "https://openrouter.ai" || url.origin === "https://api.openai.com") ? Promise.resolve(new Response("{}", { status: 503 })) : undefined);
  const app = await ui.mount({ startNew: true });
  app.type("Where should we eat on Saturday around 5?"); app.submit();
  await app.until(() => app.buttons("Try again").length === 1, "the saved failure with Try again");
  assert.match(app.alert(), /Commons couldn’t finish that reply\. Your message is saved\. Try again\./);
  assert.match(app.text(), /Where should we eat on Saturday around 5\?/, "the request stays visible in its thread");
  assert.equal(app.value(), "", "it was saved, so it is in the thread rather than the box");
  failing = false;
  app.click("Try again");
  await app.until(() => /Try the early seating near your stay\./.test(app.text()) && app.buttons("Try again").length === 0, "the retry to complete");
  const posts = ui.turnPosts();
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body!.commandId, posts[0].body!.commandId, "the same command id");
  const rows = await ui.rows();
  assert.deepEqual([rows.threads.length, rows.turns.length], [1, 1], "one thread and one saved exchange, not a duplicate");
}));

const preSaveErrors = CoordinatorErrorCodeSchema.options.filter(code => code !== "internal_error");
test("Expired auth versus internal draft mismatch: every error code has its own copy, only an expired sign-in offers to sign in, and the text stays", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let code: CoordinatorErrorCode = "auth_expired";
  ui.intercept((url, init) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? Promise.resolve(jsonResponse({ error: coordinatorError(code) }, coordinatorErrorCatalog[code].httpStatus)) : undefined);
  app.type("Where should we eat?");
  const seen = new Map<string, string>();
  for (code of preSaveErrors) {
    app.submit();
    await app.until(() => app.alert().includes(coordinatorErrorCatalog[code].userMessage), `${code} copy`);
    seen.set(code, app.alert());
    assert.equal(app.value(), "Where should we eat?", `${code}: unsent text is preserved`);
    const signIn = app.renderer.findAll(node => node.type === "a" && String(node.props.href).startsWith("/sign-in?next="));
    assert.equal(signIn.length, code === "auth_expired" ? 1 : 0, `${code}: sign-in recovery only for an expired sign-in`);
    if (code !== "auth_expired") assert.doesNotMatch(app.alert(), /\baccount\b|sign(?:ed)? in/i, `${code} must not claim a wrong account`);
    await app.idle();
  }
  assert.equal(new Set([...seen.values()]).size, preSaveErrors.length, "each code is distinguishable on screen");
  assert.match(seen.get("auth_expired")!, /Sign in again to continue\. Your unsent message is still here\./);
  assert.match(seen.get("artifact_misassociated")!, /That draft belongs to another thread/);
  assert.equal((await ui.rows()).turns.length, 1, "nothing was saved by any of these");
}));

test("Expired auth versus internal draft mismatch: a thread another organizer changed is refreshed, the text stays, and resending reuses the command", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  // Robin (another organizer) adds a turn to the same thread while Casey is typing.
  s.next.reply = "Robin's answer";
  const robin = await s.post({ commandId: randomUUID(), target: { kind: "existing", threadId: dinner.id, expectedTurnVersion: dinner.turnVersion }, inputMode: "text", text: "Robin asks about kids' menus" }, s.trip.coOrganizerId);
  assert.equal(robin.status, 200);
  actAs(s.trip.organizerId);
  s.next.reply = "Casey's answer";
  app.type("What about a late seating?"); app.submit();
  await app.until(() => app.alert().includes(coordinatorErrorCatalog.stale_version.userMessage), "the stale-version message");
  await app.until(() => /Robin asks about kids' menus/.test(app.text()), "the refreshed thread");
  assert.equal(app.value(), "What about a late seating?", "text is kept and not resubmitted");
  assert.equal(ui.turnPosts().length, 1);
  app.submit();
  await app.until(() => /Casey's answer/.test(app.text()), "the resent turn");
  const [first, second] = ui.turnPosts().map(post => post.body!);
  assert.equal(second.commandId, first.commandId, "a rejected send keeps its command id");
  assert.deepEqual([first.target.expectedTurnVersion, second.target.expectedTurnVersion], [dinner.turnVersion, dinner.turnVersion + 1], "the resend carries the refreshed version");
  assert.equal((await ui.rows()).turns.filter(turn => turn.userText === "What about a late seating?").length, 1);
}));

test("Unsent typed text before voice and topic navigation: each place keeps its own text, voice never sends it, and a refresh or a failed send keeps it", { skip }, () => withUi(async (s, ui) => {
  const lodging = await startThread(s, "Lodging costs", "Let's talk about lodging costs.", "Lodging was booked earlier.");
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: lodging.id, voice: true });
  assert.equal(app.destination(), "To: Lodging costs");
  app.type("Half-typed lodging thought");
  assert.match(app.text(), /Your typed message stays here\. Voice doesn’t send it\./);
  // Voice starts and ends; the typed text is neither used as speech context nor submitted.
  app.click(/Talk/);
  await settle(10); app.renderer.flush();
  const channel = ui.live.channel!;
  channel.emit({ type: "session.started" });
  await settle(5); app.renderer.flush();
  const end = app.buttons("End conversation")[0];
  assert.ok(end, "the voice dialog is listening");
  void (end.props.onClick as () => Promise<void>)();
  await settle(5);
  channel.emit({ type: "session.closed" });
  await app.until(() => app.buttons("Done").length === 1, "the voice conversation to end");
  assert.equal(app.value(), "Half-typed lodging thought", "voice start and end left the text alone");
  assert.equal(ui.turnPosts().length, 0, "nothing was submitted");
  assert.doesNotMatch(JSON.stringify(channel.sent), /Half-typed/, "typed text never reached the voice session");
  assert.ok(ui.live.streams.every(stream => stream.tracks.every(track => track.stopped)), "the microphone is released");
  // Another topic has its own box and its own destination; coming back restores the first.
  app.click(/Saturday dinner/);
  await app.until(() => app.destination() === "To: Saturday dinner", "the dinner topic");
  await app.idle();
  assert.equal(app.value(), "", "text typed for lodging is not carried to dinner");
  app.type("Dinner note");
  app.click(/Lodging costs/);
  await app.until(() => app.destination() === "To: Lodging costs" && app.value() === "Half-typed lodging thought", "lodging with its own text");
  await app.idle();
  assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, `thread:${dinner.id}`), "Dinner note");
  // A send that cannot be saved (sign-in expired) leaves the text where it was, and nothing else is sent.
  ui.intercept((url, init) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? Promise.resolve(jsonResponse({ error: coordinatorError("auth_expired") }, 401)) : undefined);
  app.submit();
  await app.until(() => /Sign in again to continue/.test(app.alert()), "the sign-in message");
  assert.equal(app.value(), "Half-typed lodging thought");
  assert.equal(ui.turnPosts().length, 1);
  // Refreshing the page restores it, with its destination.
  app.renderer.unmount();
  const refreshed = await ui.mount({ threadId: lodging.id });
  assert.equal(refreshed.value(), "Half-typed lodging thought");
  assert.equal(refreshed.destination(), "To: Lodging costs");
  assert.equal(ui.turnPosts().length, 1, "and still nothing was submitted for the organizer");
}));

test("Unsent typed text before voice and topic navigation: text started on Home appears in a new conversation with its destination", { skip }, () => withUi(async (s, ui) => {
  writeUnsent(s.trip.eventId, s.trip.organizerId, "new", "Typed on Home before opening voice");
  const app = await ui.mount({ startNew: true, voice: true });
  assert.equal(app.value(), "Typed on Home before opening voice");
  assert.equal(app.destination(), "To: New conversation");
  assert.equal(ui.turnPosts().length, 0);
  assert.equal(ui.live.liveRequests.length, 0, "the voice dialog does not start the microphone or a Live session by itself");
}));

test("Unsent typed text before voice and topic navigation: the voice entry opens ready on a new conversation and the microphone starts only on a tap", { skip }, () => withUi(async (s, ui) => {
  writeUnsent(s.trip.eventId, s.trip.organizerId, "new", "Typed before choosing voice");
  const app = await ui.mount({ startNew: true, startVoice: true, voice: true });
  await app.until(() => /Ready\. Your microphone is off until you start\./.test(app.text()), "the voice dialog in its ready state");
  assert.match(app.text(), /This starts a new conversation with Commons\. Anything you have typed stays in the message box and is not sent by voice\./);
  assert.equal(app.destination(), "To: New conversation");
  assert.equal(app.value(), "Typed before choosing voice");
  assert.deepEqual([ui.live.streams.length, ui.live.peers.length, ui.live.liveRequests.length], [0, 0, 0], "opening voice does not touch the microphone or a Live session");
  app.click("Start conversation");
  await app.until(() => ui.live.peers.length === 1 && ui.live.liveRequests.length === 1, "voice to start after the tap");
  assert.equal(ui.live.streams.length, 1);
  assert.equal(app.value(), "Typed before choosing voice");
  assert.equal(ui.turnPosts().length, 0, "starting voice never submits typed text");
}));

test("Unsupported answers: an honest refusal is shown as completed, changes nothing and offers no Try again", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  const calls = s.network.providerCalls.length;
  app.type("Book it"); app.submit();
  await app.until(() => /can’t book or reserve anything/.test(app.text()), "the refusal");
  assert.match(app.text(), /Commons can’t do this yet\. Nothing changed\./);
  assert.equal(app.buttons("Try again").length, 0);
  assert.equal(app.alert(), "");
  assert.equal(s.network.providerCalls.length, calls, "refused without a model call");
  assert.equal(app.value(), "");
}));

test("Clear attendance statement: the receipt shows Undo, which reverses only that update", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  app.type("I am attending the trip."); app.submit();
  await app.until(() => app.buttons("Undo attendance update").length === 1, "the receipt with Undo");
  assert.equal((await ui.rows()).drafts.length, 0, "no poll and no Save step");
  const attending = async () => (await ui.rows()).members.filter(member => member.attendanceState === "attending").map(member => member.personId);
  assert.deepEqual(await attending(), [s.trip.organizerId]);
  app.click("Undo attendance update");
  await app.until(() => /Attendance update undone\./.test(app.text()), "the undo receipt");
  assert.deepEqual(await attending(), []);
}));

test("Ask to update stay with cost: the review card carries the amount and stays unapplied until the organizer applies it", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  Object.assign(s.next, { reply: "I can prepare that lodging update.", extra: { tripSuggestion: { operations: ["stay"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: s.trip.stayId, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: 210_000, stayBookingUrl: null, stayStatus: null } } });
  const app = await ui.mount({ threadId: dinner.id });
  app.type("Update our stay: the total lodging cost is $2,100."); app.submit();
  await app.until(() => app.buttons("Apply changes").length === 1, "the trip-change review card");
  assert.match(app.text(), /Review changes to this trip/);
  assert.match(app.text(), /Nothing changes until an organizer applies this review/);
  assert.equal((await ui.rows()).stays[0].totalCents, 184_000, "not applied by asking");
  app.click("Apply changes");
  await app.until(() => /Saved trip update/.test(app.text()), "the applied receipt");
  assert.equal((await ui.rows()).stays[0].totalCents, 210_000, "applied only after the explicit review");
}));

const PLAN_REPORT = "We've confirmed fly fishing for 9 AM on 10/12. The guide (James)'s phone is 505-412-7380";
async function seedFlyFishing(s: ScenarioContext) {
  const { commons, itineraryItems } = await import("@commons/database");
  return withTestDatabase(async db => {
    await db.update(commons).set({ startsOn: "2027-10-10", endsOn: "2027-10-14" }).where(eq(commons.id, s.trip.eventId));
    const [fly] = await db.insert(itineraryItems).values({ commonsId: s.trip.eventId, title: "Fly-fishing lesson", startsAt: new Date("2027-10-12T15:00:00.000Z"), endsAt: new Date("2027-10-12T18:00:00.000Z"),
      timezone: "America/Denver", audience: "everyone", status: "planned", provenanceLabel: "Added by Casey Synthetic" }).returning();
    return fly;
  });
}
async function flyRow(id: string) { const { itineraryItems } = await import("@commons/database"); return withTestDatabase(async db => (await db.select().from(itineraryItems).where(eq(itineraryItems.id, id)))[0]); }
const planSuggestion = (id: string) => ({ operations: ["plan"], budgetCents: null, startsOn: null, endsOn: null, locationName: null, stayId: null, stayName: null, stayAddress: null, stayStartsOn: null, stayEndsOn: null, stayTotalCents: null, stayBookingUrl: null, stayStatus: null,
  planId: id, planTitle: "Fly-fishing lesson", planStatus: "confirmed", planStartsOn: "2027-10-12", planStartsTime: "09:00", planNote: null, planContactLabel: "Guide James" });
const checkboxes = (app: { renderer: { findAll: (test: (node: HostNode | OpaqueNode) => boolean) => Array<HostNode | OpaqueNode> } }) => app.renderer.findAll(node => node.type === "input" && node.props.type === "checkbox");

const planPatches = (ui: { requests: Request[] }) => ui.requests.filter(request => request.method === "PATCH");
/** True when the review card shows any full-form field (the composer's own textarea is not part of the card). */
const hasFullForm = (app: { renderer: { findAll: (test: (node: HostNode | OpaqueNode) => boolean) => Array<HostNode | OpaqueNode> } }) => {
  const fields = (node: HostNode | OpaqueNode): boolean => node.type === "select" || node.type === "textarea" || (node.type === "input" && (node.props.type === "date" || node.props.type === "time"))
    || node.children.some(child => typeof child !== "string" && fields(child));
  return app.renderer.findAll(node => typeof node.props.className === "string" && node.props.className.includes("workspace-trip-proposal")).some(fields);
};
const receiptNode = (app: { renderer: { find: (test: (node: HostNode | OpaqueNode) => boolean) => HostNode | OpaqueNode } }) => app.renderer.find(node => node.props.className === "workspace-plan-receipt");
async function reportFlyFishing(s: ScenarioContext, ui: Awaited<ReturnType<typeof kit>>, over: Record<string, unknown> = {}, text = PLAN_REPORT) {
  const fly = await seedFlyFishing(s);
  Object.assign(s.next, { reply: "I can prepare that plan update for review.", extra: { tripSuggestion: { ...planSuggestion(fly.id), ...over } } });
  const app = await ui.mount({ startNew: true });
  app.type(text); app.submit();
  await app.until(() => app.buttons("Confirm").length + app.buttons("Mark cancelled").length + app.buttons("Apply changes").length === 1, "the plan review card");
  return { fly, app };
}

test("A status-only plan proposal opens as a compact confirmation: a one-line question, one provenance line, no status, date or time fields", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  const text = app.text();
  assert.match(text, /Mark “Fly-fishing lesson” \(Oct 12, 9 AM\) confirmed\?/);
  assert.match(text, /As reported by Casey Synthetic\. Commons hasn’t checked with the vendor\./);
  assert.match(text, /Also add Guide James, 505-412-7380 to the plan note \(travelers see it\)/);
  assert.equal(hasFullForm(app), false, "no status select, date, time or note field until Edit details");
  assert.deepEqual(app.renderer.findAll(node => node.type === "h3").map(textOf).filter(value => /Mark/.test(value)).length, 1);
  assert.equal(checkboxes(app).length, 1);
  assert.equal(checkboxes(app)[0].props.checked, false, "unchecked by default");
  assert.deepEqual(app.renderer.findAll(node => node.type === "button" && /^(Confirm|Not now|Edit details)$/.test(textOf(node).trim())).map(node => textOf(node).trim()), ["Confirm", "Not now", "Edit details"]);
  assert.equal(app.buttons("Save review edits").length + app.buttons("Apply changes").length + app.buttons("Keep current").length, 0);
  assert.doesNotMatch(text, /Nothing changes until an organizer applies this review|Suggested plan update|Review changes to this plan/, "the wordy repeats are gone");
  assert.equal((await flyRow(fly.id)).status, "planned", "asking changed nothing");
}));

test("Confirm with the contact unchecked: one request, confirmed, note unchanged, a one-line receipt that takes focus once", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  app.click("Confirm");
  await app.until(() => /marked confirmed/.test(app.text()), "the one-line receipt");
  const patches = planPatches(ui);
  assert.equal(patches.length, 1, "one request, no separate save");
  assert.deepEqual([patches[0].body!.action, patches[0].body!.expectedVersion, patches[0].body!.changes, patches[0].body!.planContact], ["apply_trip", 1, undefined, { text: "Guide James, 505-412-7380", include: false }]);
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note, saved.startsAt!.toISOString()], ["confirmed", null, "2027-10-12T15:00:00.000Z"]);
  assert.match(app.text(), /Fly-fishing lesson marked confirmed · View plan/);
  assert.doesNotMatch(app.text(), /contact added to plan note/);
  assert.equal(app.buttons("Confirm").length, 0);
  assert.equal(hasFullForm(app), false);
  const receipt = receiptNode(app);
  assert.equal(receipt.props.tabIndex, -1, "programmatically focusable");
  let focused = 0; const ref = receipt.props.ref as (node: unknown) => void;
  ref({ focus: () => { focused += 1; } }); ref({ focus: () => { focused += 1; } });
  assert.equal(focused, 1, "focus moves to the receipt once after Apply");
  // A thread opened later with the review already applied shows the same receipt and does not steal focus.
  const later = await ui.mount({ threadId: (await ui.rows()).threads[0].id });
  assert.match(later.text(), /Fly-fishing lesson marked confirmed · View plan/);
  let stolen = 0; (receiptNode(later).props.ref as (node: unknown) => void)({ focus: () => { stolen += 1; } });
  assert.equal(stolen, 0);
}));

test("Confirm with the contact checked: the note contains the stored contact from one request, with no prior save", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  const [box] = checkboxes(app);
  (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); app.renderer.flush();
  assert.equal(checkboxes(app)[0].props.checked, true);
  assert.equal(app.buttons("Save review edits").length, 0, "choosing it is not a review edit");
  assert.equal(planPatches(ui).length, 0);
  assert.equal((await flyRow(fly.id)).note, null, "choosing it saves nothing");
  app.click("Confirm");
  await app.until(() => /marked confirmed/.test(app.text()), "the receipt");
  const patches = planPatches(ui);
  assert.deepEqual(patches.map(request => request.body!.action), ["apply_trip"], "no revise_trip before Apply");
  assert.deepEqual(patches[0].body!.planContact, { text: "Guide James, 505-412-7380", include: true });
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note], ["confirmed", "Guide James, 505-412-7380"]);
  assert.match(app.text(), /Fly-fishing lesson marked confirmed · contact added to plan note · View plan/);
}));

test("Not now dismisses the compact card and leaves the plan as it was", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  app.click("Not now");
  await app.until(() => /Kept current trip/.test(app.text()), "the kept receipt");
  assert.deepEqual(planPatches(ui).map(request => request.body!.action), ["dismiss_trip"]);
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note], ["planned", null]);
  assert.equal(app.buttons("Confirm").length, 0);
}));

test("Edit details opens the full form in place, and the existing choose, save review edits, apply flow still works", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  app.click("Edit details");
  await app.until(() => app.buttons("Apply changes").length === 1, "the full form");
  const text = app.text();
  assert.match(text, /Review changes to this plan/);
  assert.match(text, /Update “Fly-fishing lesson”/);
  assert.match(text, /Add to the plan note: Guide James, 505-412-7380 — travelers will see this/);
  assert.equal(app.renderer.find(node => node.type === "select" && node.props.value === "confirmed").props.value, "confirmed");
  assert.equal(app.renderer.find(node => node.type === "input" && node.props.type === "date").props.value, "2027-10-12", "the time is the saved one");
  assert.equal(app.renderer.find(node => typeof node.type === "function" && node.type.name === "TimeInput").props.value, "09:00");
  assert.equal(app.buttons("Confirm").length, 0);
  const [box] = checkboxes(app);
  assert.equal(box.props.checked, false);
  (box.props.onChange as (event: unknown) => void)({ target: { checked: true } }); app.renderer.flush();
  assert.equal(app.buttons("Apply changes").length, 0);
  assert.equal(app.buttons("Save review edits").length, 1, "in the full form, choosing the contact is still a review edit that must be saved");
  assert.equal((await flyRow(fly.id)).note, null);
  app.click("Save review edits");
  await app.until(() => app.buttons("Apply changes").length === 1, "the saved review edit");
  assert.equal(hasFullForm(app), true, "after a save the full form stays");
  assert.equal(checkboxes(app)[0].props.checked, true, "the choice survived the save");
  assert.deepEqual([(await flyRow(fly.id)).status, (await flyRow(fly.id)).note], ["planned", null], "still nothing applied");
  app.click("Apply changes");
  await app.until(() => /marked confirmed/.test(app.text()), "the receipt");
  assert.deepEqual(planPatches(ui).map(request => request.body!.action), ["revise_trip", "apply_trip"]);
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note, saved.startsAt!.toISOString()], ["confirmed", "Guide James, 505-412-7380", "2027-10-12T15:00:00.000Z"]);
  assert.match(app.text(), /Fly-fishing lesson marked confirmed · contact added to plan note · View plan/);
}));

test("Edit details, then Apply changes without choosing the contact leaves the note alone", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui);
  app.click("Edit details");
  await app.until(() => app.buttons("Apply changes").length === 1, "the full form");
  assert.equal(app.buttons("Save review edits").length, 0, "nothing to save");
  app.click("Apply changes");
  await app.until(() => /marked confirmed/.test(app.text()), "the receipt");
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note], ["confirmed", null]);
  assert.doesNotMatch(app.text(), /contact added to plan note/);
  assert.equal(app.text().includes("505-412-7380"), true, "the organizer's own message stays visible in this organizer conversation");
}));

test("A proposal that also changes the time keeps the full form, with no compact card", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui, { planStartsTime: "10:00" }, "We've confirmed fly fishing, moved to 10 AM on 10/12. The guide (James)'s phone is 505-412-7380");
  assert.equal(app.buttons("Confirm").length, 0);
  assert.equal(app.buttons("Apply changes").length, 1);
  assert.match(app.text(), /Review changes to this plan/);
  assert.equal(hasFullForm(app), true);
  assert.equal(app.renderer.find(node => typeof node.type === "function" && node.type.name === "TimeInput").props.value, "10:00");
  assert.equal((await flyRow(fly.id)).status, "planned");
}));

test("Cancelled variant: Mark cancelled, headline in the plan's time zone, and the same one-line receipt", { skip }, () => withUi(async (s, ui) => {
  const { fly, app } = await reportFlyFishing(s, ui, { planStatus: "cancelled", planStartsOn: null, planStartsTime: null, planContactLabel: null }, "We cancelled fly fishing");
  assert.match(app.text(), /Mark “Fly-fishing lesson” \(Oct 12, 9 AM\) cancelled\?/);
  assert.equal(checkboxes(app).length, 0, "no contact option without a contact");
  assert.equal(app.buttons("Confirm").length, 0);
  app.click("Mark cancelled");
  await app.until(() => /marked cancelled/.test(app.text()), "the receipt");
  const patches = planPatches(ui);
  assert.deepEqual([patches.length, patches[0].body!.action, patches[0].body!.planContact], [1, "apply_trip", undefined]);
  const saved = await flyRow(fly.id);
  assert.deepEqual([saved.status, saved.note], ["cancelled", null]);
  assert.match(app.text(), /Fly-fishing lesson marked cancelled · View plan/);
}));

test("Plan review card: the contact checkbox row is a 44px target", () => {
  const css = readFileSync(new URL("./coordinator-workspace.css", import.meta.url), "utf8");
  assert.match(css, /\.workspace-trip-travelers label \{[^}]*min-height: 44px/);
  assert.match(css, /\.workspace-plan-confirm \.workspace-plan-confirm-contact \{[^}]*min-height: 44px/, "the compact card's contact row");
  assert.match(css, /\.workspace-topic \{[^}]*min-height: 44px/, "Edit details");
  assert.match(css, /\.workspace-plan-receipt a \{[^}]*padding-block: 12px/, "View plan");
  assert.match(css, /\.workspace-plan-receipt:focus-visible \{[^}]*outline: 3px solid var\(--cm-color-focus\)/);
  assert.doesNotMatch(css.slice(css.indexOf(".workspace-plan-confirm")), /#[0-9a-fA-F]{3,8}\b|rgb\(/, "tokens only");
  assert.match(css, /\.workspace-trip-fields input:not\(\[type="checkbox"\]\), \.workspace-trip-fields select, \.workspace-trip-fields textarea \{[^}]*min-height: 44px/);
});

test("Research by text: source links remain without generic limits and freshness boilerplate", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, research: true });
  s.next.reply = "Alpine Table looks family-friendly; confirm availability with the restaurant.";
  app.type("Look up kid-friendly dinner spots near the lodge."); app.submit();
  await app.until(() => /View research · 1 source/.test(app.text()), "the research receipt");
  await app.until(() => /Alpine Table menu/.test(app.text()), "source in the selected working pane");
  assert.doesNotMatch(app.text(), /References only|Limits and unknowns|No freshness guarantee|Fresh through|Search snippet only/);
  assert.match(app.text(), /Alpine Table menu/);

  assert.equal(s.network.tavilyCalls.filter(call => call.path === "search").length, 1);
}));

test("A reply still working when the page loads shows as pending, is looked up until it settles, and never needs a second send", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  // Another tab sent a message whose answer is still being written.
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  ui.intercept((url, _init, pass) => (url.origin === "https://openrouter.ai" || url.origin === "https://api.openai.com") ? gate.then(() => pass()) : undefined);
  s.next.reply = "Answer from the other tab";
  const inFlight = s.post({ commandId: randomUUID(), target: { kind: "existing", threadId: dinner.id, expectedTurnVersion: dinner.turnVersion }, inputMode: "text", text: "Any dinner idea?" });
  for (let waited = 0; waited < 3_000 && (await ui.rows()).turns.length < 2; waited += 20) await settle(20);
  assert.equal((await ui.rows()).turns.length, 2, "the pending turn is saved");
  const app = await ui.mount({ threadId: dinner.id });
  assert.match(app.text(), /Commons is still working on this\. Your message is saved\./);
  assert.match(app.text(), /Any dinner idea\?/);
  assert.equal(app.buttons("Try again").length, 0, "pending is not a failure");
  assert.equal(ui.turnPosts().length, 0, "the page does not resend it");
  // The model finishes; the page finds out by looking the command up, without the organizer doing anything.
  release();
  await inFlight;
  await app.until(() => /Answer from the other tab/.test(app.text()), "the pending turn to settle on screen");
  assert.doesNotMatch(app.text(), /Commons is still working on this/);
  assert.equal(ui.turnPosts().length, 0, "the organizer never sent anything from this page");
}));

test("Legacy draft context: a draft made before threads still sends through the original route", { skip }, () => withUi(async (s, ui) => {
  const { saveCommonsPollDraft } = await import("@commons/database");
  const id = randomUUID();
  const draft = await saveCommonsPollDraft(s.trip.eventId, { id, commandId: randomUUID(), expectedVersion: 0, data: {
    title: "Dinner timing", intro: "Synthetic.", ballotMode: "transparent", communication: { heading: "Choose dinner", paragraphs: ["Which time works?"], links: [] },
    questions: [{ id: randomUUID(), kind: "choice", prompt: "When should we eat?", selectionMode: "single", options: [{ id: randomUUID(), label: "6 PM" }, { id: randomUUID(), label: "7 PM" }] }] } },
    { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId, sharedCoordinator: true });
  const app = await ui.mount();
  assert.equal(app.destination(), "To: Dinner timing");
  s.next.reply = "Here is a suggested change.";
  app.type("Make it friendlier"); app.submit();
  await app.until(() => ui.requests.some(request => request.method === "POST" && request.path === "" && request.body?.draftId === draft.id), "the legacy request");
  const post = ui.requests.find(request => request.method === "POST" && request.path === "")!;
  assert.deepEqual([post.body!.draftId, post.body!.draftVersion, post.body!.threadId], [draft.id, draft.version, undefined]);
  assert.equal(ui.turnPosts().length, 0, "unthreaded contexts do not use /turns");
  await app.until(() => /Here is a suggested change\./.test(app.text()), "the reply");
  assert.equal(app.value(), "");
}));

// ---------------------------------------------------------------------------------------------------------------------------------
// Voice through the Workspace (Stage 6). The real Workspace and voice dialog run against the real routes and the disposable database;
// the Live session, microphone and WebRTC are fakes ([mocked voice transport]) and the model and search are fakes. No real OpenAI session.
// ---------------------------------------------------------------------------------------------------------------------------------

type App = Awaited<ReturnType<Awaited<ReturnType<typeof kit>>["mount"]>>;
type Ui = Awaited<ReturnType<typeof kit>>;

/** Opens the voice dialog, starts the (fake) session, and returns a helper that speaks one request at a time on a running transcript clock. */
async function voiceSession(app: App, ui: Ui) {
  (app.renderer.find(byLabel("Talk with Commons")).props.onClick as () => void)();
  await settle(10); app.renderer.flush();
  const channel = ui.live.channel!;
  channel.emit({ type: "session.started" });
  await settle(2); app.renderer.flush();
  let clock = 0, count = 0;
  const commentary = () => channel.sent.filter(event => event.type === "session.commentary.append") as Array<{ delegation_id: string; content: string }>;
  return {
    channel, commentary,
    /** Speak one request and wait until its result was spoken back. */
    async say(text: string) {
      const before = commentary().length, id = `item-${count += 1}`;
      channel.emit({ type: "session.input_transcript.delta", delta: text, start_ms: clock, end_ms: clock + 800 });
      channel.emit({ type: "session.delegation.created", delegation: { id, target: "client" }, offset_ms: clock + 900 });
      clock += 2_500;
      await app.until(() => commentary().length > before, `the spoken result of "${text.slice(0, 40)}"`);
      await app.idle();
      return { id, spoken: commentary().at(-1)!.content };
    },
  };
}

test("Start a new voice restaurant topic: one named thread, one durable first turn, a relevant answer and no poll draft [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  s.next.reply = "Try an early seating near the lodge around 5.";
  const app = await ui.mount({ startNew: true, voice: true });
  assert.equal(app.destination(), "To: New conversation");
  const voice = await voiceSession(app, ui);
  assert.deepEqual(ui.live.liveBodies.map(body => body.threadId), [null], "a new conversation: the Live session is bound to no thread yet");
  const first = await voice.say("We're driving up from Denver on Friday. Where should the family eat dinner around five?");
  const [post] = ui.turnPosts();
  assert.equal(ui.turnPosts().length, 1);
  assert.deepEqual([post.body!.target.kind, post.body!.inputMode, post.body!.artifact, post.body!.explicitAction], ["new", "voice", undefined, undefined], "an ordinary new-thread turn, not a poll starter");
  assert.deepEqual(post.body!.voice, { sessionId: "live-synthetic", delegationId: "item-1" }, "real ids, not the Stage 5 placeholder");
  const rows = await ui.rows();
  assert.equal(rows.threads.length, 1, "one thread");
  assert.equal(rows.threads[0].title, "Saturday dinner", "named, not the spoken sentence");
  assert.equal(rows.turns.length, 1, "one durable first turn");
  assert.equal(rows.turns[0].userText, "We're driving up from Denver on Friday. Where should the family eat dinner around five?");
  assert.equal(rows.drafts.length, 0, "speaking created no poll draft");
  assert.equal(ui.requests.filter(request => request.path === "/drafts").length, 0);
  // What the speaking model was told: a structured result for this delegation, with the thread it belongs to.
  assert.match(first.spoken, /^\[commons_result status=completed code=none capability=answer review=no navigation=none thread="Saturday dinner"\]/);
  assert.match(first.spoken, /early seating near the lodge/);
  await app.until(() => app.destination() === "To: Saturday dinner", "the Workspace to open the created thread");
  // The server's content-free turn metric carries the correlation ids.
  const metric = s.infoLogs.find(entry => entry.name === "commons.coordinator.turn")!.detail as Record<string, unknown>;
  assert.deepEqual([metric.inputMode, metric.voiceSessionId, metric.delegationId, metric.capability], ["voice", "live-synthetic", "item-1", "answer"]);
  assert.doesNotMatch(JSON.stringify(metric), /driving up from Denver/, "no transcript in the metric");
}));

test("Second and third voice requests: they use the updated thread and version, create no second thread, and never hit a stale 409 loop [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const app = await ui.mount({ startNew: true, voice: true });
  const voice = await voiceSession(app, ui);
  s.next.reply = "Noted, you're driving.";
  await voice.say("We are driving up from Denver.");
  s.next.reply = "Try early seating near the lodge.";
  await voice.say("Where should we eat around five?");
  s.next.reply = "The lodge total is $1,840.00.";
  const third = await voice.say("What is the lodge total?");
  const posts = ui.turnPosts().map(post => post.body!);
  assert.deepEqual(posts.map(post => post.target.kind), ["new", "existing", "existing"]);
  assert.equal(new Set(posts.map(post => post.target.threadId)).size, 1, "one thread for the whole session");
  assert.deepEqual(posts.map(post => post.voice.delegationId), ["item-1", "item-2", "item-3"]);
  assert.ok(posts[2].target.expectedTurnVersion > posts[1].target.expectedTurnVersion, "each request carries the version the previous result produced");
  assert.deepEqual(voice.commentary().map(entry => /status=(\w+) code=(\w+)/.exec(entry.content)!.slice(1)), [["completed", "none"], ["completed", "none"], ["completed", "none"]], "every spoken result is a completed one: no stale 409 loop");
  assert.equal(app.alert(), "", "and no error is shown");
  const rows = await ui.rows();
  assert.equal(rows.threads.length, 1);
  assert.equal(rows.turns.length, 3);
  assert.match(third.spoken, /status=completed code=none/);
  assert.match(third.spoken, /1,840/);
  assert.equal(ui.requests.filter(request => request.method === "POST" && request.path === "/threads").length, 0, "no separate thread creation");
}));

test("Second and third voice requests: a thread another organizer changed is refreshed and the spoken request is retried exactly once [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  const voice = await voiceSession(app, ui);
  s.next.reply = "First spoken answer.";
  await voice.say("What time is dinner?");
  // Robin adds a turn to the same thread; the next spoken request is stale at reserve, so it is refreshed and retried once.
  s.next.reply = "Robin's answer";
  const known = ui.turnPosts().at(-1)!.body!.target.expectedTurnVersion as number;
  const robin = await s.post({ commandId: randomUUID(), target: { kind: "existing", threadId: dinner.id, expectedTurnVersion: known + 1 }, inputMode: "text", text: "Robin asks about kids' menus" }, s.trip.coOrganizerId);
  assert.equal(robin.status, 200, JSON.stringify(robin.body));
  actAs(s.trip.organizerId);
  s.next.reply = "Second spoken answer.";
  const before = ui.turnPosts().length;
  const second = await voice.say("Do they have a late seating?");
  const attempts = ui.turnPosts().slice(before).map(post => post.body!);
  assert.equal(attempts.length, 2, "one refresh-and-retry");
  assert.match(second.spoken, /status=completed code=none/, "the retry succeeded, so the model is told the answer, not a stale error");
  assert.notEqual(attempts[1].target.expectedTurnVersion, attempts[0].target.expectedTurnVersion, "the retry carries the refreshed version");
  const rows = await ui.rows();
  assert.equal(rows.turns.filter(turn => turn.userText === "Do they have a late seating?").length, 1, "saved once");
  assert.equal(rows.threads.length, 1, "no duplicate thread");
}));

test("Second and third voice requests: a request that is still stale after the one retry speaks the catalog message, not a reload [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  const voice = await voiceSession(app, ui);
  ui.intercept((url, init) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? Promise.resolve(jsonResponse({ error: coordinatorError("stale_version") }, 409)) : undefined);
  const spoken = await voice.say("What time is dinner?");
  assert.equal(ui.turnPosts().length, 2, "exactly one retry, never a loop");
  assert.match(spoken.spoken, /code=stale_version/);
  assert.ok(spoken.spoken.includes(coordinatorErrorCatalog.stale_version.spokenMessage));
  assert.doesNotMatch(spoken.spoken, /reload/i);
  assert.equal((await ui.rows()).turns.length, 1, "nothing was saved for the rejected request (only the setup turn exists)");
}));

test("structured failure spoken without reinterpretation: auth_expired and artifact_misassociated stay distinct, and only the sign-in case is spoken as a sign-in [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  const voice = await voiceSession(app, ui);
  const respond = (code: "auth_expired" | "artifact_misassociated") => {
    const remove = ui.intercept((url, init) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? Promise.resolve(jsonResponse({ error: coordinatorError(code) }, coordinatorErrorCatalog[code].httpStatus)) : undefined);
    return remove;
  };
  let remove = respond("auth_expired");
  const auth = await voice.say("What time is dinner?");
  remove(); remove = respond("artifact_misassociated");
  const mismatch = await voice.say("Change the poll option.");
  remove();
  assert.equal(ui.turnPosts().length, 2, "neither is retried automatically");
  assert.match(auth.spoken, /code=auth_expired/); assert.ok(auth.spoken.includes(coordinatorErrorCatalog.auth_expired.spokenMessage));
  assert.match(mismatch.spoken, /code=artifact_misassociated/); assert.ok(mismatch.spoken.includes(coordinatorErrorCatalog.artifact_misassociated.spokenMessage));
  assert.doesNotMatch(mismatch.spoken, /sign-in|sign in|account/i, "an internal mismatch never becomes an account diagnosis");
  assert.doesNotMatch(auth.spoken, /another thread/);
}));

test("Research by voice: a spoken research request uses the same capability, saves sources to the thread, and never consumes an unsent typed slash search [mocked voice transport, provider and search]", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true, research: true });
  app.type("/search Small hotels in Sonoma");
  s.next.reply = "Alpine Table looks family-friendly; confirm availability with the restaurant.";
  const voice = await voiceSession(app, ui);
  const spoken = await voice.say("Look up kid-friendly dinner spots near the lodge.");
  const post = ui.turnPosts().at(-1)!.body!;
  assert.deepEqual([post.inputMode, post.explicitAction], ["voice", undefined], "the router, not the client, decides this is research");
  assert.equal(s.network.tavilyCalls.filter(call => call.path === "search").length, 1);
  assert.doesNotMatch(String(s.network.tavilyCalls[0].body.query), /Sonoma/, "the typed query was not sent");
  assert.match(spoken.spoken, /capability=research/);
  await app.until(() => /View research · 1 source/.test(app.text()), "the research receipt in the thread");
  assert.doesNotMatch(app.text(), /References only|Limits and unknowns|No freshness guarantee|Fresh through|Search snippet only/);
  assert.equal(app.value(), "/search Small hotels in Sonoma", "the typed query is untouched");
  assert.ok((await ui.rows()).turns.some(turn => turn.threadId === dinner.id && turn.userText.startsWith("Look up kid-friendly")), "saved in the origin thread");
}));

test("Unsent typed text before voice: a spoken request is saved without the typed text, and the typed text is still there afterwards [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  app.type("PRIVATE-DRAFT-WORDS half typed");
  const voice = await voiceSession(app, ui);
  const spoken = await voice.say("What time is dinner?");
  assert.equal(app.value(), "PRIVATE-DRAFT-WORDS half typed", "typed text survives a spoken request");
  assert.doesNotMatch(JSON.stringify(ui.turnPosts().map(post => post.body)), /PRIVATE-DRAFT-WORDS/, "never sent as speech context");
  assert.doesNotMatch(JSON.stringify(voice.channel.sent) + JSON.stringify(ui.live.liveBodies) + spoken.spoken, /PRIVATE-DRAFT-WORDS/, "never reached the voice session");
  assert.equal(readUnsent(s.trip.eventId, s.trip.organizerId, `thread:${dinner.id}`), "PRIVATE-DRAFT-WORDS half typed");
}));

test("Explicitly continue in lodging thread: a spoken request opens it, the next spoken request lands there, and the model hears the change only from the results [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const lodging = await startThread(s, "Lodging costs", "Let's talk lodging costs.", "Lodging was confirmed earlier.");
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  const voice = await voiceSession(app, ui);
  assert.deepEqual(ui.live.liveBodies.map(body => body.threadId), [dinner.id], "the session starts bound to the active thread");
  const opened = await voice.say("Open the lodging thread.");
  assert.match(opened.spoken, /capability=navigate_thread .*navigation=switched/);
  assert.match(opened.spoken, /The Workspace is opening the thread "Lodging costs"/);
  await app.until(() => app.destination() === "To: Lodging costs", "the Workspace to switch");
  s.next.reply = "The lodge total is $1,840.00.";
  const next = await voice.say("What is the lodge total?");
  const post = ui.turnPosts().at(-1)!.body!;
  assert.equal(post.target.threadId, lodging.id, "the next spoken request attaches to the thread that was opened");
  assert.match(next.spoken, /thread="Lodging costs"/, "the model learns the active thread from the result");
  assert.equal((await ui.rows()).turns.filter(turn => turn.threadId === dinner.id).length, 2, "the dinner thread holds only its own turns (the setup turn and the navigation receipt)");
}));

test("Long conversation and enlarged text: after many spoken exchanges the dialog holds one bounded caption while the whole history lives in the thread [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const app = await ui.mount({ startNew: true, voice: true });
  const voice = await voiceSession(app, ui);
  for (let index = 1; index <= 5; index += 1) { s.next.reply = `Answer number ${index}.`; await voice.say(`Question number ${index} about the trip weekend.`); }
  voice.channel.emit({ type: "session.output_transcript.delta", delta: "Answer number 5.", start_ms: 90_000, end_ms: 91_000 });
  app.renderer.flush();
  const captions = app.renderer.findAll(node => node.type === "p" && node.props.className === "workspace-voice-caption");
  assert.equal(captions.length, 1, "one caption line");
  assert.ok(textOf(captions[0]).length < 320);
  const rows = await ui.rows();
  assert.equal(rows.turns.length, 5, "the durable history is in the thread");
  assert.equal(rows.threads.length, 1);
  assert.equal(new Set(ui.turnPosts().map(post => post.body!.target.threadId)).size, 1);
}));

test("R8 observability: turn and voice events carry correlated ids, latency, outcome, capability and code, and never any words spoken or answered [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  s.next.reply = "SECRET-ANSWER-WORDS about dinner.";
  const app = await ui.mount({ startNew: true, voice: true });
  const voice = await voiceSession(app, ui);
  await voice.say("SECRET-REQUEST-WORDS where should we eat?");
  await app.until(() => ui.analyticsEvents.some(event => event.eventName === "coordinator_voice_delegated"), "the delegation event");
  const delegated = ui.analyticsEvents.find(event => event.eventName === "coordinator_voice_delegated")!.properties;
  const received = ui.analyticsEvents.find(event => event.eventName === "coordinator_reply_received")!.properties;
  const post = ui.turnPosts()[0].body!;
  assert.deepEqual([delegated.sessionId, delegated.delegationId, delegated.commandId, delegated.inputMode, delegated.outcome, delegated.capability], ["live-synthetic", "item-1", post.commandId, "voice", "completed", "answer"]);
  assert.equal(typeof delegated.delegationLatencyMs, "number");
  assert.deepEqual([received.inputMode, received.commandId, received.threadId, received.sessionId, received.delegationId, received.capability, received.status], ["voice", post.commandId, post.target.threadId, "live-synthetic", "item-1", "answer", "completed"]);
  assert.equal(typeof received.latencyMs, "number");
  assert.equal(typeof received.turnId, "string");
  assert.doesNotMatch(JSON.stringify(ui.analyticsEvents), /SECRET-/, "no transcript or answer text in any client event");
}, { analytics: true }));

// ---------------------------------------------------------------------------------------------------------------------------------
// Stage 8
// ---------------------------------------------------------------------------------------------------------------------------------

test("R5 an unconfirmed first send that the organizer then edits opens the conversation it created and sends the edit there, instead of failing forever", { skip }, () => withUi(async (s, ui) => {
  const app = await ui.mount({ startNew: true });
  // The first send commits, then the connection drops, and the lookup cannot be reached either.
  let offline = true, dropped = false;
  ui.intercept((url, init, pass) => {
    if (!offline) return undefined;
    // A streamed reply commits at the end of its stream, so "after commit" means after reading it to the end.
    if (init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") && !dropped) return pass().then(async response => { await response.text(); dropped = true; throw new TypeError("connection dropped after commit"); });
    if (url.pathname.includes("/coordinator/turns/")) return Promise.reject(new TypeError("still offline"));
    return undefined;
  });
  s.next.reply = "First answer";
  app.type("Where should we eat on Saturday?"); app.submit();
  await app.until(() => /couldn’t confirm whether Commons received that/.test(app.alert()), "the unconfirmed message");
  offline = false;
  // The organizer edits the message and sends it. Before the fix every send from this conversation got command_mismatch (409) forever.
  s.next.reply = "Answer to the edited message";
  app.type("Where should the family eat on Saturday around 5?");
  assert.match(app.text(), /You’ve changed this message\. The earlier version wasn’t confirmed and may still appear in the thread/);
  app.submit();
  // The answer can stream in before the send settles; wait for the saved state, not the first streamed words.
  await app.until(() => /Answer to the edited message/.test(app.text()) && !/Commons is replying/.test(app.text()), "the edited message answered in the created thread");
  const posts = ui.turnPosts().map(post => post.body!);
  assert.equal(posts.length, 3, "first send, refused edited send, then the edit as an ordinary turn");
  assert.deepEqual(posts.slice(0, 2).map(post => post.target.kind), ["new", "new"]);
  assert.equal(posts[1].target.threadId, posts[0].target.threadId);
  assert.equal(posts[2].target.kind, "existing", "resent as a normal existing-thread turn");
  assert.equal(posts[2].target.threadId, posts[0].target.threadId, "in the thread the first send created");
  assert.equal(new Set(posts.map(post => post.commandId)).size, 3, "with a new command id");
  assert.equal(posts[2].text, "Where should the family eat on Saturday around 5?");
  assert.equal(app.destination(), "To: Saturday dinner");
  assert.equal(app.alert(), "", "no error is left on screen");
  assert.match(app.text(), /Your earlier message had reached Commons and started this conversation/, "honest copy about what happened");
  assert.match(app.text(), /First answer/, "the earlier exchange is there too");
  assert.equal(app.value(), "");
  const rows = await ui.rows();
  assert.deepEqual([rows.threads.length, rows.turns.length], [1, 2], "one thread, two saved turns");
  // And the conversation keeps working.
  s.next.reply = "Third answer";
  app.type("Anything for kids?"); app.submit();
  await app.until(() => /Third answer/.test(app.text()), "a later send in the conversation");
}));

test("R5 when nothing can be found for the earlier first send, the next send starts a fresh conversation instead of being refused again", { skip }, () => withUi(async (s, ui) => {
  const app = await ui.mount({ startNew: true });
  let stage: "lost" | "refuse" | "open" = "lost";
  ui.intercept((url, init) => {
    const turnPost = init?.method === "POST" && url.pathname.endsWith("/coordinator/turns");
    if (stage === "lost" && turnPost) return Promise.reject(new TypeError("dropped before it reached the server"));
    if (stage === "lost" && url.pathname.includes("/coordinator/turns/")) return Promise.reject(new TypeError("offline"));
    if (stage === "refuse" && turnPost) { stage = "open"; return Promise.resolve(jsonResponse({ error: coordinatorError("command_mismatch") }, 409)); }
    return undefined;
  });
  app.type("Where should we eat?"); app.submit();
  await app.until(() => /couldn’t confirm whether Commons received that/.test(app.alert()), "the unconfirmed message");
  stage = "refuse";
  app.type("Where should we eat on Saturday around 5?"); app.submit();
  await app.until(() => /Commons couldn’t match that to your earlier message, so nothing new was saved/.test(app.alert()), "the honest restart message");
  assert.equal(app.value(), "Where should we eat on Saturday around 5?", "the message is still there");
  s.next.reply = "Fresh conversation answer";
  app.submit();
  await app.until(() => /Fresh conversation answer/.test(app.text()), "the send to succeed");
  const posts = ui.turnPosts().map(post => post.body!);
  assert.equal(posts.length, 3);
  assert.notEqual(posts[2].target.threadId, posts[1].target.threadId, "a fresh thread id, not the refused one");
  assert.equal((await ui.rows()).threads.length, 1);
}));

test("R7 a spoken request that asks for another thread while the organizer moved elsewhere is spoken as declined, and the Workspace stays where the organizer is [mocked voice transport and provider]", { skip }, () => withUi(async (s, ui) => {
  const lodging = await startThread(s, "Lodging costs", "Let's talk lodging costs.", "Lodging was confirmed earlier.");
  const friday = await startThread(s, "Friday dinner", "Friday dinner ideas?");
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id, voice: true });
  const voice = await voiceSession(app, ui);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  ui.intercept((url, init, pass) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? pass().then(async response => { await gate; return response; }) : undefined);
  const before = voice.commentary().length;
  voice.channel.emit({ type: "session.input_transcript.delta", delta: "Open the lodging thread.", start_ms: 0, end_ms: 800 });
  voice.channel.emit({ type: "session.delegation.created", delegation: { id: "item-1", target: "client" }, offset_ms: 900 });
  await app.until(() => ui.turnPosts().length === 1, "the spoken request on the wire");
  // The organizer moves to another thread while Commons is still working on it.
  app.click(/Friday dinner/);
  await app.until(() => app.destination() === "To: Friday dinner", "navigation to Friday dinner");
  release();
  await app.until(() => voice.commentary().length > before, "the spoken result");
  await app.idle();
  const spoken = voice.commentary().at(-1)!.content;
  assert.match(spoken, /capability=navigate_thread/);
  assert.match(spoken, /navigation=not_opened/, "the result says the Workspace did not open it");
  assert.match(spoken, /did not open the thread "Lodging costs" because the organizer moved to another thread on screen\. Nothing switched\./);
  assert.doesNotMatch(spoken, /is opening/, "never claims a switch that did not happen");
  assert.equal(app.destination(), "To: Friday dinner", "the Workspace stayed where the organizer went");
  void lodging; void friday;
}));

test("R8 a lookup that races ahead of the commit finds the request on its second try and shows no error", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let dropped = false, lookups = 0;
  ui.intercept((url, init, pass) => {
    // A streamed reply commits at the end of its stream, so "after commit" means after reading it to the end.
    if (init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") && !dropped) return pass().then(async response => { await response.text(); dropped = true; throw new TypeError("connection dropped after commit"); });
    // The first lookup gets there before the request's commit is visible.
    if (url.pathname.includes("/coordinator/turns/") && (lookups += 1) === 1) return Promise.resolve(jsonResponse({ error: coordinatorError("artifact_missing") }, 404));
    return undefined;
  });
  s.next.reply = "Committed just after the first lookup";
  app.type("Where should we eat?"); app.submit();
  await app.until(() => /Committed just after the first lookup/.test(app.text()), "the saved answer found by the second lookup");
  assert.ok(lookups >= 2, "the first miss was asked again");
  assert.equal(ui.turnPosts().length, 1, "never sent a second time");
  assert.equal(app.alert(), "", "and no 'nothing was saved' claim");
  assert.equal((await ui.rows()).turns.filter(turn => turn.userText === "Where should we eat?").length, 1);
}));

test("R8 when two lookups find nothing the copy says it is not confirmed, keeps Check again, reuses the command on a resend and warns when the text was edited", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let lose = true;
  ui.intercept((url, init) => lose && init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? Promise.reject(new TypeError("dropped before it reached the server")) : undefined);
  app.type("Where should we eat?"); app.submit();
  await app.until(() => /hasn’t confirmed receiving your message/.test(app.alert()), "the not-confirmed message");
  assert.doesNotMatch(app.alert(), /nothing was saved|didn’t reach/i, "no claim that nothing was saved");
  assert.equal(app.buttons("Check again").length, 1, "the organizer can look again");
  assert.equal(app.value(), "Where should we eat?");
  // Edited: the earlier version may still land, and the new one is a new request.
  app.type("Where should the family eat?");
  assert.match(app.text(), /You’ve changed this message\. The earlier version wasn’t confirmed and may still appear in the thread/);
  app.type("Where should we eat?");
  assert.doesNotMatch(app.text(), /You’ve changed this message/, "unchanged text carries no warning");
  // Resending as it is reuses the same command id, so it is saved once.
  lose = false;
  s.next.reply = "Saved on the resend";
  app.submit();
  await app.until(() => /Saved on the resend/.test(app.text()), "the resend to be saved");
  const [first, second] = ui.turnPosts().map(post => post.body!);
  assert.equal(second.commandId, first.commandId, "the same command id");
  assert.equal((await ui.rows()).turns.filter(turn => turn.userText === "Where should we eat?").length, 1, "one saved exchange");
}));

test("C clarify buttons for threads with the same title show a secondary label and the current conversation is marked", { skip }, () => withUi(async (s, ui) => {
  const first = await startThread(s, "Dinner near the lodge", "Dinner idea one?");
  const second = await startThread(s, "Dinner near the lodge", "Dinner idea two?");
  const app = await ui.mount({ threadId: second.id });
  app.type("Open the dinner thread"); app.submit();
  await app.until(() => app.renderer.findAll(node => node.type === "button" && /Dinner near the lodge/.test(textOf(node)) && node.props.className === "cm-action workspace-clarify-option").length === 2, "two candidate buttons");
  const buttons = app.renderer.findAll(node => node.type === "button" && node.props.className === "cm-action workspace-clarify-option");
  const labels = buttons.map(textOf);
  assert.equal(new Set(labels).size, 2, `the buttons are told apart: ${JSON.stringify(labels)}`);
  assert.ok(labels.some(label => /this conversation/.test(label)), "the current conversation is marked");
  assert.ok(labels.every(label => /last active/.test(label)), "duplicates carry when they were last active");
  const posts = ui.turnPosts().length;
  (buttons.find(button => !/this conversation/.test(textOf(button)))!.props.onClick as () => void)();
  await app.until(() => app.destination() === "To: Dinner near the lodge", "the other thread to open");
  assert.equal(ui.turnPosts().length, posts, "still a client-side open");
  void first;
}));

// ---------------------------------------------------------------------------------------------------------------------------------
// Streaming (docs/COORDINATOR-IMPLEMENTATION-HANDOFF.md §3)
// ---------------------------------------------------------------------------------------------------------------------------------

const STREAMED = "Alpine Table opens at 4:30 near the lodge. It suits a family arriving from Denver. Prices are unverified.";

test("Streaming: the message shows at once, the box clears once it is saved, status follows real phases, and the saved turn replaces the streamed text", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let release!: () => void;
  s.next.reply = STREAMED; s.next.stream = { chunkChars: 8, gate: new Promise<void>(resolve => { release = resolve; }) };
  app.type("Where should we eat on Friday?"); app.submit();
  app.renderer.flush();
  assert.match(app.text(), /Casey Synthetic\s*Where should we eat on Friday\?/, "the message is in the thread before any reply");
  await app.until(() => /Writing a reply…/.test(app.text()), "the writing phase from the server");
  assert.equal(app.value(), "", "cleared as soon as the server saved the request");
  assert.match(app.text(), /Commons is replying in Saturday dinner\. You can keep typing/);
  // The next message can be written while this one is answered; it is kept and not sent.
  app.type("And breakfast on Saturday?");
  release();
  await app.until(() => /Alpine Table opens at 4:30 near the lodge\./.test(app.text()) && !/Commons is replying/.test(app.text()), "the saved reply");
  assert.equal(app.text().split("Alpine Table opens at 4:30").length - 1, 1, "one reply on screen, not the streamed copy plus the saved one");
  assert.match(app.text(), /Prices are unverified\./, "the last sentence arrives with the saved reply");
  assert.doesNotMatch(app.text(), /Writing a reply…|Saving the reply…/);
  assert.equal(app.value(), "And breakfast on Saturday?", "the next message is still in the box");
  assert.equal(ui.turnPosts().length, 1);
}));

test("Streaming: Stop ends the reply, the thread says you stopped it, and Try again answers the same saved message", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  let release!: () => void;
  s.next.reply = STREAMED; s.next.stream = { chunkChars: 8, gate: new Promise<void>(resolve => { release = resolve; }) };
  app.type("Where should we eat on Friday?"); app.submit();
  await app.until(() => /Writing a reply…/.test(app.text()), "the reply to start");
  let stopAnswered = false;
  ui.intercept((url, _init, pass) => url.pathname.endsWith("/stop") ? pass().then(response => { stopAnswered = true; return response; }) : undefined);
  app.click(/■/);
  await app.until(() => /Stopping…/.test(app.text()), "the stopping state");
  await app.until(() => stopAnswered, "the server to stop the reply");
  release();
  await app.until(() => /You stopped this reply\. Your message is saved/.test(app.text()), "the stopped record");
  assert.doesNotMatch(app.text(), /nothing was changed or shared/i, "Stop does not promise to undo work committed before it");
  assert.doesNotMatch(app.text(), /couldn’t finish that reply/, "a stop is not described as a failure of Commons");
  const [row] = (await ui.rows()).turns.filter(turn => turn.userText === "Where should we eat on Friday?");
  assert.doesNotMatch(row.assistantText, /Alpine/, "nothing of the stopped reply was saved");
  s.next.stream = null; s.next.reply = "Try Alpine Table at 5.";
  app.click("Try again");
  await app.until(() => /Try Alpine Table at 5\./.test(app.text()), "the retried reply");
  const posts = ui.turnPosts();
  assert.equal(posts.at(-1)!.body!.commandId, posts[0].body!.commandId, "Try again reuses the saved request");
  assert.equal((await ui.rows()).turns.filter(turn => turn.userText === "Where should we eat on Friday?").length, 1);
}));

test("Cmd+Enter sends from the Workspace composer; plain Enter only adds a line", { skip }, () => withUi(async (s, ui) => {
  const dinner = await startThread(s, "Saturday dinner");
  const app = await ui.mount({ threadId: dinner.id });
  const press = (over: Record<string, unknown>) => { let prevented = false; (app.composer().props.onKeyDown as (event: unknown) => void)({ key: "Enter", metaKey: false, ctrlKey: false, altKey: false, nativeEvent: {}, preventDefault() { prevented = true; }, ...over }); return prevented; };
  app.type("Where should we eat on Friday?");
  assert.equal(press({}), false, "plain Enter is left to the textarea");
  assert.equal(ui.turnPosts().length, 0);
  assert.equal(press({ metaKey: true }), true);
  await app.until(() => ui.turnPosts().length === 1, "the shortcut to send");
  assert.equal(ui.turnPosts()[0].body!.text, "Where should we eat on Friday?");
}));


test("Poll reliability: a dismissed Work pane stays closed when a new private poll finishes", { skip }, () => withUi(async (s, ui) => {
  s.next.extra = { operations: [{ kind: "add_question", prompt: "Which dinner?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const app = await ui.mount({ startQuestion: true });
  app.type("Create a new private dinner poll."); app.submit();
  await app.until(() => app.buttons("Review poll").length === 1, "initial private poll");
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  ui.intercept((url, init, pass) => init?.method === "POST" && url.pathname.endsWith("/coordinator/turns") ? pass().then(async response => { await gate; return response; }) : undefined);
  app.type("Create a new private restaurant poll with Alpine Table and Ridge Grill. Do not publish it."); app.submit();
  await app.until(() => ui.turnPosts().length === 2, "second request");
  const close = app.renderer.find(byLabel("Close working material"));
  (close.props.onClick as () => void)(); app.renderer.flush();
  assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, true);
  release();
  await app.until(() => app.buttons("Review poll").length === 2, "late saved poll receipt");
  await app.idle();
  assert.equal((await ui.rows()).drafts.length, 2, "both private polls were saved exactly once");
  assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, true, "late result does not reopen Work");
  assert.equal(app.buttons("Review poll").length, 2, "both saved receipts remain available");
}, { environment: { COMMONS_OPENAI_POLICY_ESCALATION_MODEL: "openai/test-planner-model" } }));

test("Poll reliability: publishing a threaded draft selects its saved poll in Work without dumping earlier research", { skip }, () => withUi(async (s, ui) => {
  const topic = await startThread(s, "Dinner choices", "Look up kid-friendly dinner spots near the lodge.");
  s.next.extra = { title: "Dinner choices", operations: [{ kind: "add_question", prompt: "Which dinner?", selectionMode: "single", options: [{ label: "Alpine Table", description: null }, { label: "Ridge Grill", description: null }] }] };
  const app = await ui.mount({ threadId: topic.id, pollEditor: true, research: true });
  app.type("Create a new private dinner poll."); app.submit();
  await app.until(() => app.buttons("Review poll").length === 1, "private poll");
  ui.intercept((url, init) => init?.method === "POST" && url.pathname.endsWith("/polls") ? (async () => {
    const poll = await createCommonsPoll(s.trip.eventId, JSON.parse(String(init.body)), { databaseUrl: process.env.TEST_DATABASE_URL!, actorPersonId: s.trip.organizerId });
    return jsonResponse({ poll }, 201);
  })() : undefined);
  app.click("Share with the group");
  await app.until(() => app.buttons("Copy for emailFormatted note and poll").length > 0 || /3?1 question.*Live/.test(app.text()), "saved poll sharing controls");
  await app.idle();
  assert.equal(app.renderer.find(byLabel("Working material")).props.hidden, false);
  const published = (await ui.rows()).polls[0]; assert.ok(published);
  const openPoll = app.renderer.findAll(node => node.type === "a" && textOf(node) === "Open poll");
  assert.ok(openPoll.some(node => String(node.props.href).startsWith("/c/poll/")));
  assert.equal(app.buttons("Share with the group").length, 0, "the saved poll is selected, not another private draft");
  assert.match(app.text(), /Dinner choices/);
  assert.equal(app.renderer.findAll(node => node.type === "section" && node.props["aria-label"] === "Share this").length, 1);
  const rows = await ui.rows(); assert.equal(rows.polls.length, 1); assert.equal(rows.drafts.length, 1);
  assert.ok(s.network.tavilyCalls.length > 0, "earlier research exists in this same conversation");
  assert.doesNotMatch(app.text(), /Alpine Table menu/, "sharing shows the selected poll rather than appending the research archive");
}, { environment: { COMMONS_OPENAI_POLICY_ESCALATION_MODEL: "openai/test-planner-model", COMMONS_INVITATION_TOKEN_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=" } }));


test("typed slash task saves immediately without approval and Undo returns a durable removed receipt", {skip},()=>withUi(async(s,ui)=>{
 const thread=await startThread(s,"Coordinator");const app=await ui.mount({threadId:thread.id});app.type("/task Ask john to each donuts");app.submit();
 await app.until(()=>/Added your task: Ask john to each donuts/.test(app.text()),"quick-add saved receipt");assert.equal(app.buttons("Save task").length,0);assert.equal(app.buttons("Not now").length,0);assert.match(app.text(),/View task/);assert.equal(app.value(),"");
 app.click("Undo");await app.until(()=>/Task removed · Ask john to each donuts/.test(app.text()),"undo persisted receipt");assert.equal(app.buttons("Undo").length,0);
},{environment:{COMMONS_ASSISTANT_UI_ENABLED:"true"}}));


test("slash list keyboard selects a tool or canonical add form without sending, and Escape preserves text",{skip},()=>withUi(async(s,ui)=>{
 const thread=await startThread(s,"Coordinator"),opened:string[]=[];const app=await ui.mount({threadId:thread.id,onAddRecord:kind=>opened.push(kind)});
 const key=(value:string)=>(app.composer().props.onKeyDown as (event:unknown)=>void)({key:value,metaKey:false,ctrlKey:false,shiftKey:false,preventDefault(){},stopPropagation(){}});
 app.type("/");assert.match(app.text(),/Poll|Task/);assert.doesNotMatch(app.text(),/\/search \(research/);
 key("ArrowDown");app.renderer.flush();key("Enter");app.renderer.flush();assert.equal(app.value(),"/poll ");assert.equal(ui.turnPosts().length,0);
 app.type("/add ");key("Enter");app.renderer.flush();assert.deepEqual(opened,["flight"]);assert.equal(app.value(),"/add ");assert.equal(ui.turnPosts().length,0);
 app.type("/add m");key("Enter");app.renderer.flush();assert.deepEqual(opened,["flight","meal"]);assert.equal(ui.turnPosts().length,0);
 app.type("/ta");key("Escape");app.renderer.flush();assert.equal(app.value(),"/ta");assert.equal(app.renderer.findAll(n=>n.props.role==="listbox").length,0);
}));


test("itinerary plus research opens the saved itinerary; sources stay an explicit secondary action", { skip }, () => withUi(async (s, ui) => {
  const topic = await startThread(s, "Winery day");
  const { syntheticItinerary } = await import("../../../packages/contracts/src/fixtures/research-itinerary");
  const content = syntheticItinerary(); content.items = content.items.map(item => ({ ...item, day: "2027-02-12" }));
  s.next.extra = content;
  s.next.deepResearch = () => Response.json({status:"completed",model:"openai/gpt-6.1-sol",output:[
    {type:"search_results",results:[{id:1,title:"Supplier",url:"https://supplier.example/groups",snippet:"Nine guests require inquiry."}]},
    {type:"message",content:[{type:"output_text",text:"Nine guests require inquiry. [web:1]"}]}]});
  const app = await ui.mount({threadId:topic.id,research:true,activityDecisions:true});
  app.type("Prepare an itinerary. Research Sonoma winery groups of nine."); app.submit();
  await app.until(() => /PRIVATE ITINERARY DRAFT/.test(app.text()), "the saved itinerary in Work");
  assert.equal(app.buttons(/View research/).length,1);
  assert.doesNotMatch(app.text(),/Research & sources/);
  app.type("Unsent follow-up");
  app.click(/View research/);
  // The hook harness reads external snapshots on render but does not subscribe.
  app.type("Unsent follow-up");
  await app.until(() => /Research & sources/.test(app.text()), "explicit research selection");
  assert.equal(app.value(),"Unsent follow-up");
  app.click("Review itinerary");
  app.type("Unsent follow-up");
  await app.until(() => /PRIVATE ITINERARY DRAFT/.test(app.text()), "return to saved itinerary");
  assert.equal(app.value(),"Unsent follow-up");
  const editor = app.renderer.find(node => typeof node.props.onAction === "function" && ItineraryDraftSchema.safeParse(node.props.draft).success);
  assert.equal(editor.props.activityDecisionsEnabled,true,"the owner pilot is explicitly enabled in this approval fixture");
  const apply = editor.props.onAction as (action: unknown) => Promise<void>;
  const beforePatches = ui.requests.filter(request => request.method === "PATCH").length;
  await assert.rejects(apply({operation:"apply",selectedIds:[content.items[0].id],taskIds:[],reviewedVersion:0}), /itinerary changed/);
  assert.equal(ui.requests.filter(request => request.method === "PATCH").length,beforePatches,"stale local review dispatches no mutation");
  await apply({operation:"apply",selectedIds:[content.items[0].id],taskIds:[],reviewedVersion:ItineraryDraftSchema.parse(editor.props.draft).version});
  await app.idle();
  const {itineraryItems}=await import("@commons/database");
  const saved=await withTestDatabase(db=>db.select().from(itineraryItems).where(eq(itineraryItems.commonsId,s.trip.eventId)));
  assert.equal(saved.length,1);assert.equal(saved[0].status,"planned");assert.match(saved[0].note!,/not booked/);
  assert.equal(app.value(),"Unsent follow-up","canonical approval preserves the composer draft");
}, {environment:{COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED:"true",COMMONS_ASSISTANT_UI_ENABLED:"true",COMMONS_COORDINATOR_INFERENCE_POLICY:"openai",COMMONS_DEEP_RESEARCH_PROVIDER:"perplexity",PERPLEXITY_API_KEY:"synthetic-key"}}));
