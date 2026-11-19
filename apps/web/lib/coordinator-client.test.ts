import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coordinatorError, coordinatorErrorCatalog, CoordinatorErrorCodeSchema, TurnResultSchema, type TurnCommand, type TurnResult } from "@commons/contracts";
import { buildTurnCommand, commandKey, errorFromResponse, forgetPendingCommand, loadPendingCommands, lookupTurn, postTurn, recoverTurn, recoveryFor, rememberPendingCommand, sendTurn, settledMessage, isSendShortcut } from "./coordinator-client";
import { clearUnsentIfSent, readUnsent, unsentDestinationFor, writeUnsent } from "./coordinator-unsent";
import { retryCommandFor, selectedArtifact } from "./coordinator-turn-command";
import { workspaceThreadId, workspaceEditableDraft } from "./coordinator-workspace-context";
import { sourceLabels } from "../components/coordinator-turn-parts";

// Pure behavior of the browser side of the turn contract: no DOM, no database, no provider.

function storage() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); }, values };
}
const thread = () => randomUUID();
function result(over: Partial<TurnResult> = {}): TurnResult {
  return TurnResultSchema.parse({ commandId: randomUUID(), status: "completed", turnId: randomUUID(), capability: "answer", thread: { id: thread(), title: "Dinner", turnVersion: 1, metadataVersion: 1 },
    spokenReply: "Try the early seating.", durableAnswer: "Try the early seating.", sources: [], artifacts: [], reviewRequired: false, navigation: null, saved: { request: true, answer: true, proposal: false }, shared: false, error: null, ...over });
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const command = (over: Partial<Parameters<typeof buildTurnCommand>[0]> = {}) => buildTurnCommand({ commandId: randomUUID(), destination: { kind: "new", threadId: thread() }, inputMode: "text", text: "Where should we eat?", ...over });

test("every stable error code has its own copy and only an expired sign-in gets a sign-in recovery", () => {
  const codes = CoordinatorErrorCodeSchema.options;
  const messages = codes.map(code => coordinatorErrorCatalog[code].userMessage);
  assert.equal(new Set(messages).size, codes.length, "no two codes share copy");
  for (const code of codes) {
    if (code !== "auth_expired") assert.doesNotMatch(coordinatorErrorCatalog[code].userMessage, /\baccount\b|sign(?:ed)? in/i, `${code} must not blame the account or ask for a sign-in`);
    assert.equal(recoveryFor(code) === "sign_in", code === "auth_expired");
  }
  assert.equal(recoveryFor("stale_version"), "refresh");
  assert.equal(recoveryFor("provider_failed"), "retry");
  assert.equal(recoveryFor("membership_lost"), "none");
});

test("error responses from the turn routes, the legacy routes, and a bare status all resolve to a stable code", () => {
  assert.deepEqual(errorFromResponse(409, { error: coordinatorError("stale_version") }), coordinatorError("stale_version"));
  assert.deepEqual(errorFromResponse(403, { error: "server text", code: "organizer_required", retryable: false }), coordinatorError("organizer_required"));
  assert.equal(errorFromResponse(401, {}).code, "auth_expired");
  assert.equal(errorFromResponse(429, null).code, "rate_limited");
  const plain = errorFromResponse(409, { error: "A saved trip record changed. Reload and prepare a fresh update." });
  assert.equal(plain.userMessage, "A saved trip record changed. Reload and prepare a fresh update.");
  assert.doesNotMatch(plain.userMessage, /account/);
  assert.equal(errorFromResponse(500, "not json").code, "internal_error");
});

test("a command built for a new conversation and for an existing thread carries exactly the contract fields", () => {
  const id = randomUUID(), threadId = thread();
  assert.deepEqual(buildTurnCommand({ commandId: id, destination: { kind: "new", threadId }, inputMode: "text", text: "hi", explicitAction: { kind: "ask_group", starterId: null } }),
    { commandId: id, target: { kind: "new", threadId }, inputMode: "text", text: "hi", explicitAction: { kind: "ask_group", starterId: null } });
  const existing = buildTurnCommand({ commandId: id, destination: { kind: "existing", threadId, expectedTurnVersion: 3 }, inputMode: "voice", text: "hi", artifact: { kind: "draft", id: randomUUID(), version: 2 }, voice: { sessionId: "live-1", delegationId: "item-1" } });
  assert.equal(existing.target.kind, "existing");
  assert.deepEqual(existing.voice, { sessionId: "live-1", delegationId: "item-1" }, "a spoken turn carries its real session and delegation ids");
  assert.throws(() => buildTurnCommand({ commandId: id, destination: { kind: "new", threadId }, inputMode: "voice", text: "hi" }), /session and delegation ids/, "no placeholder ids");
  // A resend of the same message to the same place keeps its identity even after the thread version moved; a different message does not.
  const base = { inputMode: "text" as const, text: "a" };
  assert.equal(commandKey({ ...base, destination: { kind: "existing", threadId, expectedTurnVersion: 1 } }), commandKey({ ...base, destination: { kind: "existing", threadId, expectedTurnVersion: 9 } }));
  assert.notEqual(commandKey({ ...base, destination: { kind: "existing", threadId, expectedTurnVersion: 1 } }), commandKey({ ...base, text: "b", destination: { kind: "existing", threadId, expectedTurnVersion: 1 } }));
});

test("a lost response is looked up by command id and never sent twice", async () => {
  const cmd = command(), saved = result({ commandId: cmd.commandId });
  const calls: string[] = [];
  const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input); calls.push(`${init?.method ?? "GET"} ${url.split("/coordinator")[1]}`);
    if (init?.method === "POST") throw new TypeError("connection dropped after the server committed");
    return json(saved);
  }) as typeof fetch;
  const settled = await sendTurn("trip", cmd, { fetcher, pollMs: 1 });
  assert.equal(settled.kind, "result");
  assert.deepEqual(calls, ["POST /turns", `GET /turns/${cmd.commandId}`], "one POST, then a lookup: no retry");
});

test("lookup distinguishes saved, still pending, never seen, and unreachable", async () => {
  const cmd = command();
  const answers: Array<() => Response | Promise<Response>> = [() => json(result({ commandId: cmd.commandId, status: "pending", spokenReply: null, durableAnswer: null, saved: { request: true, answer: false, proposal: false } })), () => json(result({ commandId: cmd.commandId }))];
  const pending = await recoverTurn("trip", cmd.commandId, { fetcher: (async () => answers.shift()!()) as typeof fetch, pollMs: 1 });
  assert.equal(pending.kind === "result" && pending.result.status, "completed", "keeps looking while pending");
  let lookups = 0;
  const missing = await recoverTurn("trip", cmd.commandId, { fetcher: (async () => { lookups += 1; return json({ error: coordinatorError("artifact_missing") }, 404); }) as typeof fetch, pollMs: 1, missingRetryMs: 1 });
  assert.equal(missing.kind, "not_saved", "two misses in a row are reported, as not confirmed (never as proof)");
  assert.equal(lookups, 2, "a first miss is asked again after a pause");
  const unreachable = await recoverTurn("trip", cmd.commandId, { fetcher: (async () => { throw new TypeError("offline"); }) as typeof fetch, pollMs: 1, lookupAttempts: 2 });
  assert.equal(unreachable.kind, "unconfirmed", "nothing may be assumed when the lookup cannot be reached");
  assert.match(settledMessage(unreachable as Exclude<typeof unreachable, { kind: "result" }>), /couldn’t confirm/);
  const auth = await lookupTurn("trip", cmd.commandId, { fetcher: (async () => json({ error: coordinatorError("auth_expired") }, 401)) as typeof fetch });
  assert.equal(auth.kind === "rejected" && auth.error.code, "auth_expired");
});

test("recovery stops looking up old commands after its workspace unmounts", async () => {
  for (const status of ["missing", "pending"] as const) {
    let active = true, calls = 0;
    const cmd = command();
    const settled = await recoverTurn("trip", cmd.commandId, {
      isActive: () => active,
      sleep: async () => { active = false; },
      fetcher: (async () => {
        calls += 1;
        return status === "missing" ? json({ error: coordinatorError("artifact_missing") }, 404)
          : json(result({ commandId: cmd.commandId, status: "pending", spokenReply: null, durableAnswer: null, saved: { request: true, answer: false, proposal: false } }));
      }) as typeof fetch,
    });
    assert.equal(calls, 1, `${status} recovery must not issue another request under a later session`);
    assert.equal(settled.kind, "unconfirmed", "unmounting does not infer a saved or failed outcome");
  }
});

test("a rejected turn is definitive except an unexpected server error, which is looked up first", async () => {
  const cmd = command();
  const rejected = await postTurn("trip", cmd, { fetcher: (async () => json({ error: coordinatorError("stale_version") }, 409)) as typeof fetch });
  assert.equal(rejected.kind === "rejected" && rejected.error.code, "stale_version");
  const unexpected = await postTurn("trip", cmd, { fetcher: (async () => json({ error: coordinatorError("internal_error") }, 500)) as typeof fetch });
  assert.equal(unexpected.kind, "unconfirmed");
});

test("commands in flight survive a reload and are forgotten once settled", () => {
  const store = storage(), cmd = command();
  rememberPendingCommand("trip", "actor", cmd, store);
  assert.deepEqual(loadPendingCommands("trip", "actor", store).map(item => item.command.commandId), [cmd.commandId]);
  assert.deepEqual(loadPendingCommands("trip", "someone-else", store), [], "scoped to the actor");
  forgetPendingCommand("trip", "actor", cmd.commandId, store);
  assert.deepEqual(loadPendingCommands("trip", "actor", store), []);
  store.setItem("commons:trip:actor:coordinator-pending", "{not json");
  assert.deepEqual(loadPendingCommands("trip", "actor", store), [], "corrupt storage is ignored, never thrown");
});

test("unsent text is kept per destination, cleared only when the exact text was sent, and never throws", () => {
  const store = storage(), thread = "thread:11111111-1111-4111-8111-111111111111" as const;
  writeUnsent("trip", "actor", thread, "half typed", store);
  writeUnsent("trip", "actor", "new", "another idea", store);
  assert.equal(readUnsent("trip", "actor", thread, store), "half typed");
  assert.equal(readUnsent("trip", "actor", "new", store), "another idea", "each place has its own text");
  assert.equal(readUnsent("trip", "other", thread, store), "");
  clearUnsentIfSent("trip", "actor", thread, "something else", store);
  assert.equal(readUnsent("trip", "actor", thread, store), "half typed", "text typed after pressing Send is not lost");
  clearUnsentIfSent("trip", "actor", thread, "half typed", store);
  assert.equal(readUnsent("trip", "actor", thread, store), "");
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  writeUnsent("trip", "actor", "new", "x", blocked);
  assert.equal(readUnsent("trip", "actor", "new", blocked), "");
  assert.equal(unsentDestinationFor({ startingQuestion: true, startingThread: false, selected: "thread:x" }), "ask");
  assert.equal(unsentDestinationFor({ startingQuestion: false, startingThread: true, selected: "thread:x" }), "new");
  assert.equal(unsentDestinationFor({ startingQuestion: false, startingThread: false, selected: "new" }), "new");
  assert.equal(unsentDestinationFor({ startingQuestion: false, startingThread: false, selected: "thread:x" }), "thread:x");
});

test("thread sources read as From <title>, saved facts collapse to one line, research stays in the research pane", () => {
  const id = randomUUID();
  const labels = sourceLabels([
    { kind: "thread", threadId: id, title: "Lodging costs", turnIds: [] },
    { kind: "trip_fact", factId: "stay:1", label: "Synthetic Peak Lodge", version: 1 }, { kind: "trip_fact", factId: "trip", label: "Trip", version: 1 },
    { kind: "research_source", researchRunId: randomUUID(), sourceId: "s1", url: "https://example.com", retrievedAt: "2026-09-29T12:00:00.000Z" },
  ]);
  assert.deepEqual(labels.map(item => item.label), ["Based on saved trip details", "From Lodging costs"]);
  assert.deepEqual(sourceLabels(null), []);
});

test("the artifact a message is about comes from the latest thread payload: an editable draft wins over a poll", () => {
  const threadId = randomUUID(), draftId = randomUUID(), pollId = randomUUID(), at = "2026-09-29T12:00:00.000Z";
  const data = { title: "t", intro: "", ballotMode: "transparent", communication: { heading: "h", paragraphs: [], links: [] }, questions: [] };
  const payload = { version: 2, turns: [], hasEarlier: false, activeThreadId: threadId, threads: [], linkedIdeas: [], researchRuns: [],
    drafts: [{ id: draftId, threadId, version: 3, data, createdAt: at, updatedAt: at, publishedPollId: null }],
    polls: [{ id: pollId, threadId, publicId: "abcdef123456", title: "p", status: "open", createdAt: at, audienceRestricted: false, responseCount: 0, resultsVisible: false, results: [] }] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const latest = payload as any;
  assert.equal(workspaceThreadId(`draft:${draftId}`, latest), threadId, "reopening an owned draft sends and applies in its durable conversation");
  assert.equal(workspaceThreadId(`poll:${pollId}`, latest), threadId);
  assert.equal(workspaceThreadId(`draft:${randomUUID()}`, latest), undefined, "a missing artifact never borrows another thread");
  assert.equal(workspaceThreadId("new", latest), undefined);
  assert.deepEqual(selectedArtifact(latest, `thread:${threadId}`), { kind: "draft", id: draftId, version: 3, selection: "thread_context" }, "the thread's goal draft is attached as context, never as a selection");
  assert.deepEqual(selectedArtifact(latest, `draft:${draftId}`), { kind: "draft", id: draftId, version: 3 }, "a draft the organizer chose is selected");
  assert.equal(workspaceEditableDraft(`thread:${threadId}`, latest)?.id, draftId);
  assert.equal(workspaceEditableDraft(`draft:${draftId}`, latest)?.id, draftId);
  latest.drafts[0].publishedPollId = pollId;
  assert.deepEqual(selectedArtifact(latest, `thread:${threadId}`), { kind: "poll", id: pollId });
  const replacementId = randomUUID();
  latest.drafts.push({ ...latest.drafts[0], id: replacementId, publishedPollId: null });
  assert.equal(workspaceEditableDraft(`thread:${threadId}`, latest)?.id, replacementId);
  assert.equal(workspaceEditableDraft(`poll:${pollId}`, latest), undefined, "opening older results never substitutes a newer draft");
  assert.equal(workspaceEditableDraft(`draft:${draftId}`, latest), undefined, "a published draft is no longer editable");
  assert.equal(selectedArtifact(latest, "new"), undefined);
  assert.deepEqual(selectedArtifact(latest, `note:${draftId}`), { kind: "note", turnId: draftId });
});

test("a failed turn's command is rebuilt with the same command id, as a new-thread command only for a thread's first turn", () => {
  const threadId = randomUUID(), commandId = randomUUID(), at = "2026-09-29T12:00:00.000Z";
  const turn = { id: randomUUID(), commandId, sequence: 1, userText: "  Where should we eat? ", assistantText: "x", draftId: null, createdAt: at, threadId, status: "failed" as const, inputMode: "text" as const, errorCode: "provider_failed" as const };
  const payload = { version: 1, turns: [turn], hasEarlier: false, activeThreadId: threadId, threads: [], linkedIdeas: [], researchRuns: [], drafts: [], polls: [] };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const built = retryCommandFor(turn, payload as any, 1) as TurnCommand;
  assert.deepEqual([built.commandId, built.target, built.text], [commandId, { kind: "new", threadId }, "Where should we eat?"]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const later = retryCommandFor({ ...turn, sequence: 2 }, payload as any, 4) as TurnCommand;
  assert.deepEqual(later.target, { kind: "existing", threadId, expectedTurnVersion: 4 });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  assert.equal(retryCommandFor({ ...turn, commandId: undefined }, payload as any, 1), null);
});

test("R8 a lookup that races ahead of the commit is asked again before it is believed, and 'not saved' never claims nothing was saved", async () => {
  const cmd = command(), saved = result({ commandId: cmd.commandId });
  let calls = 0;
  const racing = (async () => { calls += 1; return calls === 1 ? json({ error: coordinatorError("artifact_missing") }, 404) : json(saved); }) as typeof fetch;
  const found = await recoverTurn("trip", cmd.commandId, { fetcher: racing, pollMs: 1, missingRetryMs: 1 });
  assert.equal(found.kind, "result", "the second lookup found the request that was still being committed");
  assert.equal(calls, 2);
  const notConfirmed = settledMessage({ kind: "not_saved" });
  assert.match(notConfirmed, /hasn’t confirmed receiving your message/);
  assert.match(notConfirmed, /saved only once/, "a resend as it is reuses the command, so it cannot duplicate");
  assert.doesNotMatch(notConfirmed, /nothing was saved|didn’t reach/i);
});

test("Cmd+Enter or Ctrl+Enter sends; plain Enter, Shift+Enter, Alt+Enter and IME composition do not", () => {
  const key = (over: Partial<Parameters<typeof isSendShortcut>[0]>) => isSendShortcut({ key: "Enter", metaKey: false, ctrlKey: false, ...over });
  assert.equal(key({ metaKey: true }), true);
  assert.equal(key({ ctrlKey: true }), true);
  assert.equal(key({}), false);
  assert.equal(key({ shiftKey: true }), false);
  assert.equal(key({ metaKey: true, altKey: true }), false);
  assert.equal(key({ metaKey: true, nativeEvent: { isComposing: true } }), false);
  assert.equal(isSendShortcut({ key: "a", metaKey: true, ctrlKey: false }), false);
});
