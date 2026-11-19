import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createElement } from "react";
import { TurnResultSchema, type TurnResult } from "@commons/contracts";
import { createHookRenderer, registerComponentImportStubs, textOf, type HostNode, type OpaqueNode } from "../lib/test-support/hook-harness";
import { installFakeLiveEnvironment, settle, type FakeLiveEnvironment } from "../lib/test-support/fake-live-transport";
import type { VoiceDelegateOutcome, VoiceDelegation } from "../lib/coordinator-live";

// The voice dialog against the fake live transport: a fake microphone, a fake WebRTC peer and data channel, and the fake Live session start
// endpoint. NO real OpenAI session, microphone or audio is used anywhere in this file; every test is marked [mocked transport].
registerComponentImportStubs();
type Module = typeof import("./coordinator-live-conversation");
type Props = Parameters<Module["CoordinatorLiveConversation"]>[0];
const load = async () => import("./coordinator-live-conversation");

const outcomeResult = (over: Partial<TurnResult> = {}): VoiceDelegateOutcome => ({ kind: "result", result: TurnResultSchema.parse({
  commandId: randomUUID(), status: "completed", turnId: randomUUID(), capability: "answer",
  thread: { id: randomUUID(), title: "Saturday dinner", turnVersion: 2, metadataVersion: 1 },
  spokenReply: "Early seating near the stay works well.", durableAnswer: "Early seating near the stay works well.",
  sources: [], artifacts: [], reviewRequired: false, navigation: null, saved: { request: true, answer: true, proposal: false }, shared: false, error: null, ...over,
}) });

const byLabel = (label: string) => (node: HostNode | OpaqueNode) => node.props["aria-label"] === label;
const withTimings = async (voiceModule: Module, run: () => Promise<void>) => {
  const saved = { ...voiceModule.voiceTiming };
  Object.assign(voiceModule.voiceTiming, { transcriptSettleMs: 5, transcriptWaitMs: 20, transcriptRetryMs: 5, closeWaitMs: 40, respondingIdleMs: 25, announceSettleMs: 25, reconnectGraceMs: 40, connectTimeoutMs: 400, iceGatherMs: 60 });
  try { await run(); } finally { Object.assign(voiceModule.voiceTiming, saved); }
};

async function mount(options: { onDelegate?: Props["onDelegate"]; env?: Parameters<typeof installFakeLiveEnvironment>[0]; activeThreadId?: string | null; startReady?: boolean } = {}) {
  const voiceModule = await load();
  const live = installFakeLiveEnvironment(options.env);
  const calls: VoiceDelegation[] = [];
  const wrapped: Props["onDelegate"] = request => { calls.push(request); return (options.onDelegate ?? (async () => outcomeResult()))(request); };
  const renderer = createHookRenderer({ expand: [voiceModule.CoordinatorLiveConversation] });
  const props = (over: Partial<Props> = {}): Props => ({ available: true, disabled: false, coordinatorName: "Commons", slug: "qa-synthetic", onDelegate: wrapped, activeThreadId: options.activeThreadId ?? null, startReady: options.startReady ?? false, ...over });
  renderer.render(createElement(voiceModule.CoordinatorLiveConversation, props()));
  const app = {
    voiceModule, live, renderer, calls, props,
    text: () => renderer.tree.map(textOf).join("\n"),
    buttons: (label: string) => renderer.findAll(node => node.type === "button" && textOf(node).trim() === label),
    button(label: string) { const [found] = app.buttons(label); assert.ok(found, `no "${label}" button in: ${app.text()}`); return found; },
    click(label: string) { void (app.button(label).props.onClick as () => unknown)(); renderer.flush(); },
    async talk() { (renderer.find(byLabel("Talk with Commons")).props.onClick as () => void)(); await settle(5); renderer.flush(); },
    async begin() { await app.talk(); app.channel().emit({ type: "session.started" }); await settle(2); renderer.flush(); },
    channel: () => live.channel!,
    said(text: string, startMs: number, endMs: number) { app.channel().emit({ type: "session.input_transcript.delta", delta: text, start_ms: startMs, end_ms: endMs }); },
    delegate(id: string, offsetMs: number) { app.channel().emit({ type: "session.delegation.created", delegation: { id, target: "client" }, offset_ms: offsetMs }); },
    commentary: () => live.channel!.sent.filter(event => event.type === "session.commentary.append") as Array<{ delegation_id: string; content: string; event_id: string }>,
    status: () => textOf(renderer.find(node => node.type === "p" && node.props.className === "workspace-voice-status")),
    live_region: () => textOf(renderer.find(node => node.props["aria-live"] === "polite")),
    caption: () => renderer.findAll(node => node.type === "p" && node.props.className === "workspace-voice-caption"),
    async until(condition: () => boolean, what: string, ms = 2_000) {
      for (let waited = 0; waited < ms; waited += 5) { renderer.flush(); if (condition()) return; await settle(5); }
      renderer.flush(); assert.ok(condition(), `timed out waiting for ${what}. Status: ${app.text().slice(0, 500)}`);
    },
    cleanup() { renderer.unmount(); live.restore(); },
  };
  return app;
}
type App = Awaited<ReturnType<typeof mount>>;
async function scenario(options: Parameters<typeof mount>[0], run: (app: App) => Promise<void>) {
  const voiceModule = await load();
  await withTimings(voiceModule, async () => { const app = await mount(options); try { await run(app); await settle(30); } finally { app.cleanup(); } });
}
const microphoneReleased = (live: FakeLiveEnvironment) => live.streams.length > 0 && live.streams.every(stream => stream.tracks.every(track => track.stopped));

// Diagnosis for observed failure 2 (repeated 409 at "reserve" on later voice turns): the data-channel listener used to capture the
// render-time `onDelegate`, so every later delegation ran the session-start callback and its old thread/version state.
test("Second and third voice requests: each delegation uses the latest onDelegate, not the one captured at session start [mocked transport]", () => scenario({ onDelegate: async () => outcomeResult() }, async app => {
  const seen: string[] = [];
  const atStart: Props["onDelegate"] = async request => { seen.push(`session-start:${request.text}`); return outcomeResult(); };
  const afterFirst: Props["onDelegate"] = async request => { seen.push(`latest:${request.text}`); return outcomeResult(); };
  app.renderer.render(createElement(app.voiceModule.CoordinatorLiveConversation, app.props({ onDelegate: atStart })));
  await app.begin();
  // The Workspace re-renders after its first saved turn: a new callback for the new thread version.
  app.renderer.render(createElement(app.voiceModule.CoordinatorLiveConversation, app.props({ onDelegate: afterFirst })));
  app.said("Where should we eat around five?", 100, 900);
  app.delegate("delegation-2", 1_000);
  await app.until(() => seen.length === 1, "the delegation");
  assert.deepEqual(seen, ["latest:Where should we eat around five?"]);
}));

// R6 lifecycle: "guard against late async startup reopening a closed session".
test("Interrupt, mute, end, close during connection, disconnect, unmount: closing while the microphone prompt is pending starts nothing afterwards [mocked transport]", async () => {
  const voiceModule = await load();
  const live = installFakeLiveEnvironment({ holdMicrophone: true });
  const renderer = createHookRenderer({ expand: [voiceModule.CoordinatorLiveConversation] });
  try {
    renderer.render(createElement(voiceModule.CoordinatorLiveConversation, { available: true, disabled: false, coordinatorName: "Commons", slug: "qa-synthetic", onDelegate: async () => outcomeResult() }));
    (renderer.find(byLabel("Talk with Commons")).props.onClick as () => void)();
    await settle(0);
    renderer.flush();
    const close = renderer.find(node => node.type === "button" && node.children.includes("Close"));
    await (close.props.onClick as () => Promise<void> | void)();
    renderer.flush();
    live.releaseMicrophone();
    await settle(10);
    const observed = { peersCreated: live.peers.length, liveSessionRequests: live.liveRequests.length, microphoneStopped: live.streams.every(stream => stream.tracks.every(track => track.stopped)) };
    assert.deepEqual(observed, { peersCreated: 0, liveSessionRequests: 0, microphoneStopped: true }, `observed: ${JSON.stringify(observed)}`);
  } finally { renderer.unmount(); live.restore(); }
});

test("Interrupt, mute, end, close during connection, disconnect, unmount: closing while the Live session is being created aborts it and releases everything [mocked transport]", () => scenario({ env: { holdLive: true } }, async app => {
  await app.talk();
  await app.until(() => app.live.liveRequests.length === 1, "the session request");
  assert.equal(app.live.peers.length, 1);
  await (app.button("Close").props.onClick as () => Promise<void>)();
  app.renderer.flush();
  app.live.releaseLive();
  await settle(30);
  assert.equal(app.live.peers[0].closed, true, "the connection is released");
  assert.ok(microphoneReleased(app.live), "the microphone is released");
  assert.equal(app.live.peers.length, 1, "nothing restarts");
  app.channel().emit({ type: "session.started" });
  app.delegate("late-1", 1_000);
  await settle(30);
  assert.equal(app.calls.length, 0, "events after close are ignored");
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: mute silences the microphone without ending the session, and unmute restores it [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  const [track] = app.live.streams[0].tracks;
  const mute = app.button("Mute microphone");
  assert.equal(mute.props["aria-pressed"], false);
  app.click("Mute microphone");
  assert.equal(track.enabled, false, "the browser sends silence");
  assert.equal(app.button("Mute microphone").props["aria-pressed"], true);
  assert.match(app.status(), /Microphone muted\. Commons can’t hear you\./, "state is stated in text, not only by pressed styling");
  assert.equal(track.stopped, false, "the session is still open");
  assert.equal(app.live.peers[0].closed, false);
  // A request already spoken still completes while muted.
  app.said("Compare the stays.", 100, 900); app.delegate("d-1", 1_000);
  await app.until(() => app.commentary().length === 1, "the result");
  app.click("Mute microphone");
  assert.equal(track.enabled, true);
  assert.equal(app.button("Mute microphone").props["aria-pressed"], false);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: End asks Live to close, waits for session.closed, then stops the microphone [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  void (app.button("End conversation").props.onClick as () => Promise<void>)();
  await settle(2);
  assert.ok(app.channel().sent.some(event => event.type === "session.close"), "close requested");
  assert.equal(app.live.peers[0].closed, false, "the connection stays until Live confirms");
  app.channel().emit({ type: "session.closed", reason: "close_requested" });
  await app.until(() => app.buttons("Done").length === 1, "the ended state");
  assert.equal(app.live.peers[0].closed, true);
  assert.ok(microphoneReleased(app.live));
  assert.match(app.status(), /Conversation ended/);
  // Late events after the end are ignored.
  app.said("Anything?", 100, 500); app.delegate("late", 600);
  await settle(30);
  assert.equal(app.calls.length, 0);
  assert.equal(app.commentary().length, 0);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: End with no answer from Live still releases after the wait [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  void (app.button("End conversation").props.onClick as () => unknown)();
  await settle(90);
  app.renderer.flush();
  assert.equal(app.live.peers[0].closed, true);
  assert.ok(microphoneReleased(app.live));
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: a lost connection is stated truthfully, releases the microphone, and reconnecting never replays a delegation [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.said("What time is dinner?", 100, 900); app.delegate("d-1", 1_000);
  await app.until(() => app.calls.length === 1 && app.commentary().length === 1, "the first delegation");
  // Transient: `disconnected` says so and recovers by itself.
  app.live.peers[0].setConnectionState("disconnected"); app.renderer.flush();
  assert.match(app.status(), /Connection lost\. Trying to reconnect/);
  app.live.peers[0].setConnectionState("connected"); app.renderer.flush();
  assert.match(app.status(), /Listening/);
  // Terminal: `failed`.
  app.live.peers[0].setConnectionState("failed"); app.renderer.flush();
  const alert = textOf(app.renderer.find(node => node.props.role === "alert"));
  assert.match(alert, /The voice connection failed\. Requests already sent are still saved in the thread, and nothing will be repeated\./);
  assert.ok(microphoneReleased(app.live));
  // Starting again is a new session: the old delegation id is not run again.
  await (app.button("Try again").props.onClick as () => Promise<void>)();
  await settle(5); app.renderer.flush();
  assert.equal(app.live.peers.length, 2);
  app.live.peers[1].channel!.emit({ type: "session.started" });
  app.live.peers[1].channel!.emit({ type: "session.delegation.created", delegation: { id: "d-1", target: "client" }, offset_ms: 500 });
  // Wait for the outcome itself, not a fixed 30 ms: the wait window is 20 ms plus retries, so a fixed pause is only as long as the window and flakes under load.
  await app.until(() => /didn’t catch enough/.test(app.live.peers[1].channel!.sent.map(event => String(event.content ?? "")).join("\n")), "the request to repeat");
  assert.equal(app.calls.length, 1, "a redelivered id from the old session is not an old turn; with no new speech it only asks to repeat");
  assert.match(app.live.peers[1].channel!.sent.map(event => String(event.content ?? "")).join("\n"), /didn’t catch enough/);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: a connection that stays lost gives up after a grace period [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.live.peers[0].setConnectionState("disconnected");
  await app.until(() => app.renderer.findAll(node => node.props.role === "alert").length === 1, "the lost-connection message", 500);
  assert.match(textOf(app.renderer.find(node => node.props.role === "alert")), /The voice connection was lost/);
  assert.ok(microphoneReleased(app.live));
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: unmounting stops the microphone and connection and ignores later events [mocked transport]", async () => {
  const voiceModule = await load();
  await withTimings(voiceModule, async () => {
    const app = await mount();
    try {
      await app.begin();
      app.said("Compare the stays.", 100, 900); app.delegate("d-1", 1_000);
      app.renderer.unmount();
      assert.ok(microphoneReleased(app.live));
      assert.equal(app.live.peers[0].closed, true);
      await settle(30);
      assert.equal(app.calls.length, 0, "no delegation starts after unmount");
      app.channel().emit({ type: "session.delegation.created", delegation: { id: "d-2", target: "client" }, offset_ms: 2_000 });
      await settle(20);
      assert.equal(app.calls.length, 0);
    } finally { app.live.restore(); }
  });
});

test("Interrupt, mute, end, close during connection, disconnect, unmount: navigating away (pagehide) stops the microphone [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  (globalThis.window as unknown as EventTarget).dispatchEvent(new Event("pagehide"));
  assert.ok(microphoneReleased(app.live));
  assert.equal(app.live.peers[0].closed, true);
}));

test("duplicate/late delegation events: a delegation delivered three times makes one request, one command id, one spoken result [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.said("Where should we eat around five?", 100, 900);
  app.delegate("item-1", 1_000); app.delegate("item-1", 1_000);
  await app.until(() => app.commentary().length === 1, "the result");
  app.delegate("item-1", 1_000);
  await settle(40);
  assert.equal(app.calls.length, 1, "one turn");
  assert.equal(app.commentary().length, 1, "one spoken result");
  assert.equal(app.commentary()[0].delegation_id, "item-1");
  assert.equal(app.calls[0].delegationId, "item-1");
  assert.match(app.calls[0].sessionId, /^live-synthetic$/, "the real session id from the Live start response, not a placeholder");
  // A delegation with a non-client target is not ours to run.
  app.channel().emit({ type: "session.delegation.created", delegation: { id: "item-2", target: "responses" }, offset_ms: 2_000 });
  await settle(30);
  assert.equal(app.calls.length, 1);
}));

test("duplicate/late delegation events: a delegation whose outcome was unknown reruns with the SAME command id when redelivered [mocked transport]", () => scenario({ onDelegate: async () => ({ kind: "unconfirmed" }) }, async app => {
  await app.begin();
  app.said("What time is dinner?", 100, 900);
  app.delegate("item-1", 1_000);
  await app.until(() => app.calls.length === 1 && app.commentary().length === 1, "the first attempt");
  assert.match(app.commentary()[0].content, /code=unconfirmed/);
  app.delegate("item-1", 1_000);
  await app.until(() => app.calls.length === 2, "the redelivered attempt");
  assert.equal(app.calls[1].commandId, app.calls[0].commandId, "the server replays instead of duplicating");
  assert.equal(app.calls[1].text, app.calls[0].text, "the same words; nothing re-read from the transcript");
}));

test("queue overflow: one request runs at a time, two may wait, and the fourth is told the truth and never queued [mocked transport]", async () => {
  const gates: Array<() => void> = [];
  const started: string[] = [];
  await scenario({ onDelegate: request => new Promise<VoiceDelegateOutcome>(resolve => { started.push(request.text); gates.push(() => resolve(outcomeResult())); }) }, async app => {
    await app.begin();
    const requests = ["Find dinner near the lodge.", "What is the lodge total?", "Add the sleigh ride idea.", "Also check the bar hours."];
    requests.forEach((text, index) => { app.said(text, index * 2_000, index * 2_000 + 800); });
    requests.forEach((_, index) => app.delegate(`item-${index + 1}`, index * 2_000 + 1_000));
    await app.until(() => app.commentary().length === 1, "the overflow line");
    assert.equal(app.commentary()[0].delegation_id, "item-4");
    assert.match(app.commentary()[0].content, /code=busy .*I’m still working on your earlier request/);
    assert.deepEqual(started, ["Find dinner near the lodge."], "one in flight");
    assert.match(app.status(), /Working on “Find dinner near the lodge\.” · 2 waiting/);
    gates[0](); await app.until(() => started.length === 2, "the second request");
    gates[1](); await app.until(() => started.length === 3, "the third request");
    gates[2](); await app.until(() => app.commentary().length === 4, "all results");
    assert.deepEqual(started, requests.slice(0, 3), "first in, first out; the overflowed request was never run");
    assert.deepEqual(app.commentary().map(entry => entry.delegation_id), ["item-4", "item-1", "item-2", "item-3"]);
    assert.equal(new Set(app.calls.map(call => call.commandId)).size, 3, "each delegation has its own command id");
  });
});

test("Second and third voice requests: independent requests spoken back to back stay separate turns with their own words [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.said("We are driving up from Denver.", 100, 900); app.delegate("item-1", 1_000);
  await app.until(() => app.calls.length === 1, "the first request");
  app.said("Where should we eat around five?", 2_100, 2_900); app.delegate("item-2", 3_000);
  await app.until(() => app.calls.length === 2, "the second request");
  assert.deepEqual(app.calls.map(call => call.text), ["We are driving up from Denver.", "Where should we eat around five?"]);
  assert.notEqual(app.calls[0].commandId, app.calls[1].commandId);
  assert.equal(app.calls[0].sessionId, app.calls[1].sessionId);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: interrupting speech never cancels running work, which stays visible as Working on and is spoken when it finishes [mocked transport]", async () => {
  let finish: () => void = () => {};
  await scenario({ onDelegate: () => new Promise<VoiceDelegateOutcome>(resolve => { finish = () => resolve(outcomeResult()); }) }, async app => {
    await app.begin();
    app.said("Compare the two lodges for us.", 100, 900); app.delegate("item-1", 1_000);
    await app.until(() => /Working on “Compare the two lodges for us\.”/.test(app.status()), "the working status");
    // The organizer talks over the coordinator: playback stops in the model; the request keeps running and stays shown.
    app.channel().emit({ type: "session.output_transcript.delta", delta: "One moment while I", start_ms: 1_100, end_ms: 1_500 });
    app.said("Actually, wait.", 1_600, 2_100);
    app.renderer.flush();
    assert.match(app.status(), /Working on “Compare the two lodges for us\.”/, "work outranks Responding and Listening");
    assert.equal(app.commentary().length, 0, "nothing was cancelled, repeated or spoken early");
    assert.equal(app.calls.length, 1);
    finish();
    await app.until(() => app.commentary().length === 1, "the result");
    await app.until(() => /Listening/.test(app.status()), "back to listening");
  });
});

test("structured failure spoken without reinterpretation: auth_expired and artifact_misassociated reach the speaking model as their own results [mocked transport]", async () => {
  const codes = ["auth_expired", "artifact_misassociated"] as const;
  const queue = [...codes];
  await scenario({ onDelegate: async () => ({ kind: "rejected", code: queue.shift()!, answerOnly: true }) }, async app => {
    await app.begin();
    app.said("Where should we eat?", 100, 900); app.delegate("item-1", 1_000);
    await app.until(() => app.commentary().length === 1, "first failure");
    app.said("And the lodge total?", 2_100, 2_900); app.delegate("item-2", 3_000);
    await app.until(() => app.commentary().length === 2, "second failure");
    const [auth, mismatch] = app.commentary().map(entry => entry.content);
    assert.match(auth, /code=auth_expired/); assert.match(auth, /sign-in expired/);
    assert.match(mismatch, /code=artifact_misassociated/); assert.match(mismatch, /belongs to another thread/);
    assert.doesNotMatch(mismatch, /sign-in|account/i);
    assert.doesNotMatch(`${auth}\n${mismatch}`, /reload/i);
    // The dialog itself does not show an account error for a request that failed.
    assert.equal(app.renderer.findAll(node => node.props.role === "alert").length, 0);
  });
});

test("Research by voice: a spoken research request is delegated like any other and its structured result names the capability [mocked transport]", () => scenario({ onDelegate: async () => outcomeResult({ capability: "research", spokenReply: "I saved three sources about family dinner spots. Prices and availability are unverified." }) }, async app => {
  await app.begin();
  app.said("Look up kid friendly dinner spots near Breckenridge.", 100, 1_400); app.delegate("item-1", 1_500);
  await app.until(() => app.commentary().length === 1, "the research result");
  assert.equal(app.calls[0].text, "Look up kid friendly dinner spots near Breckenridge.");
  assert.match(app.commentary()[0].content, /capability=research .*unverified/);
}));

test("Start a new voice restaurant topic: the session starts bound to no thread, then to the active thread when there is one [mocked transport]", async () => {
  const threadId = randomUUID();
  await scenario({ activeThreadId: null }, async app => { await app.talk(); assert.deepEqual(app.live.liveBodies.map(body => body.threadId), [null]); });
  await scenario({ activeThreadId: threadId }, async app => { await app.talk(); assert.deepEqual(app.live.liveBodies.map(body => body.threadId), [threadId]); });
});

test("Unsent typed text before voice: the dialog states it never sends typed text, and the session never receives any [mocked transport]", () => scenario({ startReady: true }, async app => {
  await app.until(() => /Ready\. Your microphone is off until you start\./.test(app.status()), "the ready state");
  assert.match(app.text(), /Anything you have typed stays in the message box and is not sent by voice\./);
  assert.deepEqual([app.live.streams.length, app.live.peers.length, app.live.liveRequests.length], [0, 0, 0], "the microphone stays off until Start");
  app.click("Start conversation");
  await settle(5); app.renderer.flush();
  assert.equal(app.live.liveBodies.length, 1);
  assert.deepEqual(Object.keys(app.live.liveBodies[0]).sort(), ["sdp", "threadId"], "only the offer and the thread binding are sent");
}));

test("Long conversation and enlarged text: one bounded caption line, the dialog states what is saved, and End, Mute and Close are real buttons [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  for (let index = 0; index < 300; index += 1) app.said(`word${index} `, index * 100, index * 100 + 90);
  app.channel().emit({ type: "session.output_transcript.delta", delta: "Sure. Early seating near the stay works well.", start_ms: 40_000, end_ms: 41_000 });
  app.renderer.flush();
  const captions = app.caption();
  assert.equal(captions.length, 1, "one caption line, not a transcript wall");
  assert.ok(textOf(captions[0]).length <= 300, `${textOf(captions[0]).length}`);
  assert.match(textOf(captions[0]), /^Commons Sure\. Early seating/, "the active speaker's latest utterance replaced the organizer's");
  for (const label of ["Close", "End conversation", "Mute microphone"]) assert.ok(app.button(label).type === "button", label);
  assert.match(app.text(), /Commons saves only the requests it works on, and its answers, in the organizer thread\. It does not save a recording or a full transcript\./);
  assert.doesNotMatch(app.text(), /Delegated exchanges are saved/);
}));

test("Long conversation and enlarged text: only settled, non-filler coordinator captions are announced to assistive technology [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  assert.equal(app.live_region(), "Listening.");
  app.channel().emit({ type: "session.output_transcript.delta", delta: "Mm-hmm.", start_ms: 100, end_ms: 400 });
  await settle(60);
  app.renderer.flush();
  assert.equal(app.live_region(), "Listening.", "a backchannel is captioned but not announced");
  app.channel().emit({ type: "session.output_transcript.delta", delta: "Early seating near the stay ", start_ms: 3_000, end_ms: 3_500 });
  app.channel().emit({ type: "session.output_transcript.delta", delta: "works well.", start_ms: 3_500, end_ms: 4_000 });
  app.renderer.flush();
  assert.equal(app.live_region(), "Listening.", "not announced while it is still arriving");
  await app.until(() => app.live_region() === "Early seating near the stay works well.", "the settled caption announcement");
  app.said("Thanks.", 5_000, 5_300);
  await settle(60); app.renderer.flush();
  assert.equal(app.live_region(), "Early seating near the stay works well.", "the organizer's own words are not announced back");
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: denied microphone permission shows recovery copy and starts nothing [mocked transport]", () => scenario({ env: { microphoneError: "NotAllowedError" } }, async app => {
  await app.talk();
  const alert = textOf(app.renderer.find(node => node.props.role === "alert"));
  assert.match(alert, /Microphone access was not allowed\. Allow microphone access for Commons in your browser settings, then try again\. Nothing was started\./);
  assert.deepEqual([app.live.peers.length, app.live.liveRequests.length], [0, 0]);
  assert.ok(app.button("Try again"));
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: blocked audio playback is stated, captions keep working, and playback can be started again [mocked transport]", () => scenario({ env: { playbackBlocked: true } }, async app => {
  await app.begin();
  app.live.peers[0].deliverRemoteAudio();
  await settle(5); app.renderer.flush();
  assert.match(app.text(), /Your browser blocked audio playback, so you can’t hear Commons\. Captions still work\./);
  app.channel().emit({ type: "session.output_transcript.delta", delta: "Early seating works.", start_ms: 100, end_ms: 900 });
  app.renderer.flush();
  assert.match(textOf(app.caption()[0]), /Early seating works\./);
  const playedBefore = app.live.audios[0].played;
  app.click("Play audio");
  assert.equal(app.live.audios[0].played, playedBefore + 1);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: an error event is not treated as the end of the session [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.channel().emit({ type: "error", error: { code: "moderation", client_event_id: "other" } });
  app.renderer.flush();
  assert.match(app.text(), /Voice hit a problem with the last reply\./);
  assert.equal(app.renderer.findAll(node => node.props.role === "alert").length, 0);
  assert.equal(app.live.peers[0].closed, false, "the session and microphone continue");
  assert.match(app.status(), /Listening/);
}));

test("Interrupt, mute, end, close during connection, disconnect, unmount: a session that Live ends on its own says why and releases the microphone [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  app.channel().emit({ type: "session.closed", reason: "expired" });
  app.renderer.flush();
  assert.match(app.text(), /The voice session reached its time limit and ended\./);
  assert.match(app.status(), /Conversation ended/);
  assert.ok(microphoneReleased(app.live));
}));

test("R8 observability: voice events carry session, delegation and command ids, latency, outcome and code, and never the words spoken or the reply [mocked transport]", async () => {
  const analytics: Array<{ eventName: string; properties: Record<string, unknown> }> = [];
  await scenario({
    env: { pathname: "/c/qa-synthetic/coordinator/", liveFetch: async (url, init) => {
      if (url.endsWith("/api/v1/analytics/events")) { analytics.push(JSON.parse(String(init?.body))); return new Response("{}", { status: 201 }); }
      throw new Error(`unexpected ${url}`);
    } },
    onDelegate: async () => outcomeResult({ capability: "answer", spokenReply: "SECRET-REPLY-TEXT works well." }),
  }, async app => {
    await app.begin();
    app.said("SECRET-REQUEST-TEXT where should we eat?", 100, 900); app.delegate("item-1", 1_000);
    await app.until(() => analytics.some(event => event.eventName === "coordinator_voice_delegated"), "the delegation event");
    const delegated = analytics.find(event => event.eventName === "coordinator_voice_delegated")!.properties;
    assert.equal(delegated.inputMode, "voice");
    assert.equal(delegated.sessionId, "live-synthetic");
    assert.equal(delegated.delegationId, "item-1");
    assert.equal(delegated.commandId, app.calls[0].commandId);
    assert.equal(delegated.outcome, "completed");
    assert.equal(delegated.capability, "answer");
    assert.equal(typeof delegated.delegationLatencyMs, "number");
    assert.equal(analytics.find(event => event.eventName === "coordinator_voice_started")!.properties.sessionId, "live-synthetic");
    assert.doesNotMatch(JSON.stringify(analytics), /SECRET-/, "no transcript or reply text in any event");
    void (app.button("End conversation").props.onClick as () => unknown)();
    await app.until(() => analytics.some(event => event.eventName === "coordinator_voice_ended"), "the ended event");
    assert.ok(analytics.some(event => event.eventName === "coordinator_voice_ended"));
  });
});

// R6: End, then Close, then Talk again before the first session finished closing.
test("R6 End, Close, then Talk before Live confirms the close: the old End must not shut down the new session [mocked transport]", () => scenario({}, async app => {
  await app.begin();
  const first = app.live.peers[0], firstStream = app.live.streams[0];
  void (app.button("End conversation").props.onClick as () => unknown)();
  await settle(2);
  assert.ok(first.channel!.sent.some(event => event.type === "session.close"), "the first session was asked to close");
  // Close while that is still pending (closeWaitMs is 40 ms in these tests), then Talk again inside the wait.
  await (app.button("Close").props.onClick as () => Promise<void>)();
  app.renderer.flush();
  await app.talk();
  assert.equal(app.live.peers.length, 2, "a second session was started");
  const second = app.live.peers[1], secondStream = app.live.streams[1];
  second.channel!.emit({ type: "session.started" });
  await settle(2); app.renderer.flush();
  // The first End's wait runs out now. It belongs to the first session and must leave the second one alone.
  await settle(120);
  app.renderer.flush();
  assert.equal(first.closed, true, "the first session was released");
  assert.ok(firstStream.tracks.every(track => track.stopped), "and so was its microphone");
  assert.equal(second.closed, false, "the new session's connection is still open");
  assert.ok(secondStream.tracks.every(track => !track.stopped), "the new session's microphone is still on");
  assert.match(app.status(), /Listening/, "and the dialog still says so, not 'Conversation ended'");
  // It really is live: a request on the new session still works.
  app.said("What time is dinner?", 100, 900); app.delegate("second-1", 1_000);
  await app.until(() => app.calls.length === 1, "a delegation on the new session");
}));

// R12: ICE gathering that never completes.
test("R12 network address gathering that never finishes fails with honest copy and releases everything, without contacting Live [mocked transport]", () => scenario({ env: { holdIce: true } }, async app => {
  await app.talk();
  await app.until(() => /couldn’t connect to the network in time/.test(app.text()), "the timeout message", 1_000);
  assert.match(app.text(), /Check your connection, then try again\. Nothing was started\./);
  assert.equal(app.live.liveRequests.length, 0, "no session was requested from Live");
  assert.equal(app.live.peers[0].closed, true, "the connection was released");
  assert.ok(microphoneReleased(app.live), "the microphone was released");
  assert.match(app.status(), /Voice stopped/);
  assert.equal(app.buttons("Try again").length, 1, "and the organizer can try again");
}));

test("the first request of a session is heard even when its words are transcribed late (live: the first request was always \"I didn't catch that\")", () => scenario({}, async app => {
  await app.begin();
  app.delegate("d-late", 2_000);
  // No words yet when the delegation arrives; they come in after the settle time but within the wait.
  await settle(12);
  app.said("When is Sam's riding lesson?", 400, 1_900);
  await app.until(() => app.calls.length === 1, "the request to be sent");
  assert.equal(app.calls[0].text, "When is Sam's riding lesson?");
  assert.doesNotMatch(app.channel().sent.map(event => String(event.content ?? "")).join("\n"), /didn’t catch enough/);
}));

test("speech whose timestamps do not line up with the delegation is still this request, once the wait is over", () => scenario({}, async app => {
  await app.begin();
  // The transcript clock runs ahead of the delegation offset: nothing falls inside the window.
  app.said("What time can we check in?", 9_000, 10_500);
  app.delegate("d-skew", 2_000);
  await app.until(() => app.calls.length === 1, "the request to be sent");
  assert.equal(app.calls[0].text, "What time can we check in?");
}));

test("with no speech at all, the organizer is still asked to repeat after the wait, and nothing is sent", () => scenario({}, async app => {
  await app.begin();
  app.delegate("d-silent", 2_000);
  await settle(60);
  assert.equal(app.calls.length, 0);
  assert.match(app.channel().sent.map(event => String(event.content ?? "")).join("\n"), /didn’t catch enough/);
}));
