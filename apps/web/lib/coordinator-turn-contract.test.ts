import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CapabilityIdSchema, CoordinatorErrorCodeSchema, CoordinatorWorkspaceSchema, RoutedIntentSchema, TurnCapabilitySchema, coordinatorCapabilityRegistry, coordinatorError, coordinatorErrorCatalog,
  CoordinatorThreadStateSchema, CoordinatorTurnLifecycleSchema, assertCoordinatorTurnRowInvariants,
  TurnCommandSchema, TurnResultSchema,
} from "@commons/contracts";

test("every coordinator error code has one catalog entry with status, retry policy, and copy", () => {
  for (const code of CoordinatorErrorCodeSchema.options) {
    const entry = coordinatorErrorCatalog[code];
    assert.ok(entry, code);
    assert.ok(entry.httpStatus >= 400 && entry.httpStatus < 600, code);
    assert.deepEqual(coordinatorError(code), { code, retryable: entry.retryable, userMessage: entry.userMessage });
  }
  assert.equal(Object.keys(coordinatorErrorCatalog).length, CoordinatorErrorCodeSchema.options.length);
});

test("error copy never invents an account diagnosis or a reload the coordinator cannot perform", () => {
  for (const [code, entry] of Object.entries(coordinatorErrorCatalog)) {
    assert.doesNotMatch(entry.spokenMessage, /reload|refresh/i, `${code} spoken copy must not claim a reload`);
    if (!["auth_expired", "membership_lost", "organizer_required"].includes(code)) {
      assert.doesNotMatch(`${entry.userMessage} ${entry.spokenMessage}`, /account|sign in/i, `${code} must not blame the account`);
    }
  }
  assert.notEqual(coordinatorErrorCatalog.auth_expired.userMessage, coordinatorErrorCatalog.artifact_misassociated.userMessage);
});

test("turn commands bind voice metadata to voice turns and keep new conversations artifact-free", () => {
  const base = { commandId: randomUUID(), target: { kind: "existing", threadId: randomUUID(), expectedTurnVersion: 2 }, inputMode: "text", text: "Where should we eat?" } as const;
  assert.equal(TurnCommandSchema.safeParse(base).success, true);
  assert.equal(TurnCommandSchema.safeParse({ ...base, inputMode: "voice" }).success, false, "voice needs session and delegation ids");
  assert.equal(TurnCommandSchema.safeParse({ ...base, inputMode: "voice", voice: { sessionId: "s", delegationId: "d" } }).success, true);
  assert.equal(TurnCommandSchema.safeParse({ ...base, target: { kind: "new", threadId: randomUUID() }, artifact: { kind: "poll", id: randomUUID() } }).success, false);
  assert.equal(TurnCommandSchema.safeParse({ ...base, explicitAction: { kind: "ask_group", starterId: null } }).success, true);
});

test("turn results separate status from prose and never claim sharing", () => {
  const completed = { commandId: randomUUID(), status: "completed", turnId: randomUUID(), thread: { id: randomUUID(), title: "Dinner", turnVersion: 1, metadataVersion: 1 },
    spokenReply: "Try the early seating.", durableAnswer: "Try the early seating near the stay.", sources: [], artifacts: [], reviewRequired: false, navigation: null,
    saved: { request: true, answer: true, proposal: false }, shared: false, error: null } as const;
  assert.equal(TurnResultSchema.safeParse(completed).success, true);
  assert.equal(TurnResultSchema.safeParse({ ...completed, status: "failed" }).success, false, "failed needs an error");
  assert.equal(TurnResultSchema.safeParse({ ...completed, status: "failed", durableAnswer: null, spokenReply: null, error: coordinatorError("provider_failed") }).success, true);
  assert.equal(TurnResultSchema.safeParse({ ...completed, shared: true }).success, false);
});

test("capability registry keeps Commons proposals behind review and polls explicit", () => {
  assert.deepEqual(Object.keys(coordinatorCapabilityRegistry).sort(), [...CapabilityIdSchema.options].sort());
  const entries = Object.values(coordinatorCapabilityRegistry);
  for (const entry of entries) if (entry.effect === "proposal") assert.equal(entry.reviewRequired, true, entry.id);
  assert.deepEqual(entries.filter(entry => entry.effect === "direct_with_undo").map(entry => entry.id), ["record_attendance"]);
  assert.equal(coordinatorCapabilityRegistry.prepare_poll.explicitOnly, true);
  assert.equal(coordinatorCapabilityRegistry.answer.explicitOnly, false);
});

test("Stage 4 additions: results name their capability, navigation is a typed union, and routed intents stay bounded", () => {
  const base = { commandId: randomUUID(), status: "completed", turnId: randomUUID(), thread: { id: randomUUID(), title: "Dinner", turnVersion: 1, metadataVersion: 1 },
    spokenReply: "Opened Lodging.", durableAnswer: "Opened “Lodging”. Your next message continues there.", sources: [], artifacts: [], reviewRequired: false,
    saved: { request: true, answer: true, proposal: false }, shared: false, error: null } as const;
  const lodging = randomUUID();
  assert.equal(TurnResultSchema.parse({ ...base, navigation: null }).capability, null, "older results without a capability still parse");
  for (const capability of TurnCapabilitySchema.options) assert.equal(TurnResultSchema.safeParse({ ...base, navigation: null, capability }).success, true, capability);
  assert.equal(TurnResultSchema.safeParse({ ...base, capability: "navigate_thread", navigation: { kind: "switched", threadId: lodging, title: "Lodging" } }).success, true);
  assert.equal(TurnResultSchema.safeParse({ ...base, capability: "navigate_thread", navigation: { kind: "clarify", candidates: [{ threadId: lodging, title: "Friday dinner" }] } }).success, false, "a clarification needs at least two candidates");
  assert.equal(TurnResultSchema.safeParse({ ...base, capability: "book_it", navigation: null }).success, false, "no undeclared capability");
  assert.equal(RoutedIntentSchema.safeParse({ capability: "retrieve_context", threadIds: [], ambiguousThreadIds: [randomUUID(), randomUUID()] }).success, true);
  assert.deepEqual(RoutedIntentSchema.parse({ capability: "retrieve_context", threadIds: [] }), { capability: "retrieve_context", threadIds: [], ambiguousThreadIds: [] });
  assert.equal(RoutedIntentSchema.safeParse({ capability: "record_attendance", personIds: [randomUUID()] }).success, false, "the model cannot name who to mark as attending");
  assert.equal(RoutedIntentSchema.safeParse({ capability: "unsupported", reason: "wire_money" }).success, false);
  assert.equal(CoordinatorWorkspaceSchema.safeParse({ capability: "answer" }).success, false, "an ordinary answer carries no stored capability");
  assert.equal(CoordinatorWorkspaceSchema.safeParse({ capability: "unsupported", navigation: { kind: "created", threadId: lodging, title: "Ski" } }).success, true);
});

const lifecycle = (over: Record<string, unknown> = {}) => ({ v: 1, status: "completed", inputMode: "text", errorCode: null, attempt: 1, leaseExpiresAt: null, spokenReply: "Short reply.", sources: [], completedAt: "2027-01-01T10:00:00.000Z", provisionalTitle: null, ...over });

test("the stored lifecycle enforces every invariant the removed CHECK constraints held", () => {
  const ok = (over: Record<string, unknown>) => CoordinatorTurnLifecycleSchema.safeParse(lifecycle(over)).success;
  assert.equal(ok({}), true);
  assert.equal(ok({ status: "pending", leaseExpiresAt: "2027-01-01T10:02:00.000Z", completedAt: null, spokenReply: null }), true);
  assert.equal(ok({ status: "failed", errorCode: "provider_failed", completedAt: null, spokenReply: null }), true);
  // failed <=> errorCode
  assert.equal(ok({ status: "failed", completedAt: null, spokenReply: null }), false);
  assert.equal(ok({ errorCode: "provider_failed" }), false);
  assert.equal(ok({ status: "pending", errorCode: "provider_failed", leaseExpiresAt: "2027-01-01T10:02:00.000Z", completedAt: null, spokenReply: null }), false);
  // attempt 1..3
  for (const attempt of [0, 4, 1.5, -1]) assert.equal(ok({ attempt }), false, `attempt ${attempt}`);
  for (const attempt of [1, 2, 3]) assert.equal(ok({ attempt }), true, `attempt ${attempt}`);
  // a lease exists exactly while pending; completedAt exactly when completed; only completed turns speak or cite
  assert.equal(ok({ status: "pending", completedAt: null, spokenReply: null }), false);
  assert.equal(ok({ leaseExpiresAt: "2027-01-01T10:02:00.000Z" }), false);
  assert.equal(ok({ completedAt: null }), false);
  assert.equal(ok({ status: "failed", errorCode: "provider_failed", completedAt: null }), false, "a failed turn has no spoken reply");
  // bounded spoken reply, versioned, no unknown keys
  assert.equal(ok({ spokenReply: "x".repeat(600) }), true);
  assert.equal(ok({ spokenReply: "x".repeat(601) }), false);
  assert.equal(ok({ v: 2 }), false);
  assert.equal(ok({ surprise: true }), false);
  // completed => non-empty answer (assistant_text is a column, so the row-level assertion carries it)
  const life = CoordinatorTurnLifecycleSchema.parse(lifecycle());
  assert.doesNotThrow(() => assertCoordinatorTurnRowInvariants({ assistantText: "An answer.", lifecycle: life }));
  for (const assistantText of ["", "   ", "\n"]) assert.throws(() => assertCoordinatorTurnRowInvariants({ assistantText, lifecycle: life }), /non-empty answer/);
});

test("thread state bounds: summary <= 400, at most 3 open questions of <= 200 characters", () => {
  const state = (over: Record<string, unknown>) => CoordinatorThreadStateSchema.safeParse({ v: 1, summary: "s", summaryTurnVersion: 1, openQuestions: ["q"], generatedTitle: null, ...over }).success;
  assert.equal(state({}), true);
  assert.equal(state({ summary: "x".repeat(400) }), true);
  assert.equal(state({ summary: "x".repeat(401) }), false);
  assert.equal(state({ openQuestions: ["a", "b", "c"] }), true);
  assert.equal(state({ openQuestions: ["a", "b", "c", "d"] }), false);
  assert.equal(state({ openQuestions: ["x".repeat(201)] }), false);
  assert.equal(state({ generatedTitle: "x".repeat(61) }), false);
});

test("production main tolerates the stored lifecycle: its workspace schema is not strict, so extra keys are stripped and pending/failed rows parse", () => {
  // Production main's CoordinatorWorkspaceSchema is a plain z.object (no .strict()), so it is exactly this schema without our keys.
  const mainSchema = CoordinatorWorkspaceSchema.omit({ lifecycle: true, threadState: true, capability: true, navigation: true, linkedIdea: true });
  for (const workspace of [{ lifecycle: lifecycle({ status: "pending", leaseExpiresAt: "2027-01-01T10:02:00.000Z", completedAt: null, spokenReply: null }) },
    { lifecycle: lifecycle({ status: "failed", errorCode: "provider_failed", completedAt: null, spokenReply: null }) },
    { saved: true, lifecycle: lifecycle(), threadState: { v: 1, summary: "s", summaryTurnVersion: 1, openQuestions: [], generatedTitle: "t" }, capability: "unsupported" }]) {
    assert.equal(CoordinatorWorkspaceSchema.safeParse(workspace).success, true, "this code's schema validates the stored keys");
    const parsed = mainSchema.safeParse(workspace);
    assert.equal(parsed.success, true, "main parses rows that carry our keys");
    assert.equal("lifecycle" in parsed.data!, false, "and strips them");
  }
});
