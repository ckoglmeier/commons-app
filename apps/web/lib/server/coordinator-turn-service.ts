import { canUseCoordinatorSearch } from "./coordinator-search-access";
import { tavilyLookupConfigured } from "./coordinator-research-tavily";
import { readCoordinatorSources, CommandAccessError, CommandConflictError } from "@commons/database";
import { assembleCoordinatorSources, CoordinatorSourceBudgetError } from "../coordinator-source-context";
import { authenticatedGoalOptions } from "./polls";
import { itineraryModelText } from "../itinerary-model-input";
import { processInvitationDelivery } from "@/lib/server/commons";
import { goalConversationContext } from "@/lib/server/coordinator-goal-service";
import { coordinatorError, TurnCommandSchema, TurnResultSchema, type CapabilityId, type CoordinatorErrorCode, type CoordinatorWorkspace, type TurnArtifactResult, type TurnCapability, type TurnCommand, type TurnPhase, type TurnResult } from "@commons/contracts";
import { CoordinatorTurnError, type CoordinatorTurnRecord } from "@commons/database";
import { coordinatorStarter } from "@/lib/coordinator-starters";
import { provisionalTitle } from "@/lib/coordinator-turn-title";
import { researchForCoordinator } from "@/lib/server/coordinator-research";
import { converseWithCoordinator } from "@/lib/server/coordinator-review-inference";
import { planItinerary } from "@/lib/server/coordinator-itinerary-inference";
import { renderTripContextForModel } from "@/lib/server/coordinator-context-prompt";
import { CoordinatorProviderError, coordinatorErrorCode } from "@/lib/server/coordinator-errors";
import { coordinatorProviderReady, derivedIdSeed, isModelFreeRequest, routeAndDispatch, routeIntentFor, spokenSummary, type DispatchInput, type DispatchResult } from "@/lib/server/coordinator-capabilities";
import { steerTurn, type SteerDependencies, type SteerOutcome } from "@/lib/server/coordinator-steering";
import { authenticatedThreadRelations, authenticatedTripChangeContext, beginAuthenticatedCoordinatorTurn, completeAuthenticatedCoordinatorTurn, coordinatorWorkspaceEnabled, failAuthenticatedCoordinatorTurn, findAuthenticatedCoordinatorTurn, loadAuthenticatedCoordinatorThread, loadAuthenticatedTripContext } from "@/lib/server/polls";
import { coordinatorSteeringEnabled, coordinatorTripChangesEnabled, commonsSiteOrigin, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { coordinatorGoalsAvailableFor } from "./goal-access";
import { COORDINATOR_POLICY_VERSION } from "@/lib/server/coordinator-inference-policy";
import { itineraryOperation, tripTaskOperation } from "../coordinator-artifact-intent";
import { isCommonsOperatorRequest } from "@/lib/server/operator";
import { coordinatorInferenceTrace } from './posthog-ai';
import { withInferenceSpan, type InferenceTrace } from './inference-tracing';
import { lodgingModelResolveEnabled, nativeLodgingSelected } from "@/lib/server/lodging/config";
import { lodgingRequest } from "@/lib/server/lodging/intent";
import { lodgingMayHandle, runNativeLodgingTurn } from "@/lib/server/lodging/turn";
import { reserveAuthenticatedTurnInference, authenticatedCoordinationOptions, authenticatedTurnAttemptIsLive, interruptAuthenticatedCoordinatorTurn } from "@/lib/server/polls";

/*
 * The one place a coordinator turn happens (docs/COORDINATOR-WORKSPACE-DESIGN.md §5.2). Text and, from
 * Stage 6, voice both call this. Persist the request first, run inference outside any database
 * transaction, then save the outcome or a stable failure. Explicit invitation requests queue only
 * the supplied recipients; Commons-proposed trip changes still require review.
 */

export type CoordinatorTurnDependencies = {
  infer: typeof converseWithCoordinator; inferItinerary: typeof planItinerary; research: typeof researchForCoordinator; fetcher?: typeof fetch;
  now?: () => Date; signal?: AbortSignal;
  /** Only used for analytics observers; never for authorization. */
  request?: Request;
  /**
   * Streaming observers. `onAccepted` fires once the request is saved (or found saved); phases and reply text follow as they happen.
   * Streamed text has passed the sentence-level honesty guard and is a prefix of the reply that is saved.
   */
  onAccepted?: (turn: { turnId: string; threadId: string; replayed: boolean }) => void;
  onPhase?: (phase: TurnPhase) => void;
  onReplyDelta?: (textSoFar: string) => void;
  /**
   * The organizer pressed Stop. Unlike `signal` (the client went away, so the turn is left pending for lookup), a stop ends the work and records the turn
   * as not finished, so it is immediately retryable. A reply that was already committed stays committed: stopping is not an undo.
   */
  stopSignal?: AbortSignal;
  /** Whether the signed-in person is a Commons operator (exempt from the hourly inference limit). Test seam; defaults to the operator allowlist. */
  isOperator?: () => Promise<boolean>;
  /** Called once the last stop check has passed and the outcome is about to be saved. */
  onCommitting?: () => void;
  /** Test seam for the task-steering reading and the task operations (continuity). Only used while COMMONS_COORDINATOR_STEERING_ENABLED is on. */
  steering?: SteerDependencies;
  /** Test seam for the on-demand read of another organizer thread. */
  readExcerpt?: (threadId: string) => Promise<{ threadId: string; title: string; turns: Array<{ turnId: string; userText: string; assistantText: string }> }>;
  /** Synthetic collector/export seam. Created only AFTER real trip authentication and command reservation. */
  traceFactory?: typeof coordinatorInferenceTrace;
  /** Test seam for the hard and stream-idle deadlines (milliseconds). Production uses `turnDeadlines`. */
  deadlines?: { hardMs?: number; idleMs?: number };
  /**
   * Durable execution (A2). `admit`: accept the turn and its execution row in one transaction and return the pending result without running it.
   * `execute`: the runner, inside `runAsTurnPrincipal`, runs an attempt it has claimed; every write carries the claim token and is refused when stale.
   */
  durable?: DurableTurnMode;
};

export type DurableTurnMode =
  | { mode: "admit"; authUserId: string | null }
  | { mode: "execute"; claim: { turnId: string; attempt: number; token: string }; admission: { operator: boolean; reserve: boolean; itineraryGeneration: boolean };
      /** Commits the provider-started mark; false when the claim is no longer current. */
      onProviderStart: () => Promise<boolean> };

/**
 * Hard and stream-idle limits for the work between acceptance and commit (A1). The hard limit ends work that never returns, including a provider that
 * ignores its AbortSignal; it is the smaller of the turn lease and the route's host budget, minus time reserved to save the outcome. The idle limit ends a
 * reply that stopped arriving after it started. Either way the attempt is recorded as interrupted and nothing it produces later can be saved.
 */
export function turnDeadlines(itinerary: boolean) {
  // Ordinary lease 120s, itinerary lease 240s, route maxDuration 180s; 15s / 10s reserved for validation and commit.
  return { hardMs: itinerary ? 170_000 : 105_000, idleMs: 30_000 };
}

export class TurnDeadlineError extends Error { constructor(readonly kind: "hard" | "idle") { super(`Turn ${kind} deadline exceeded.`); } }
/** The attempt is no longer the live one (stopped elsewhere, lease lost, or interrupted). Nothing more may be done for it. */
export class TurnFencedError extends Error { constructor() { super("Turn attempt is no longer live."); } }

// Trip records are small: a typical trip renders well under this, so the model sees every saved record. Over the cap, plans, then polls, then
// other conversations are trimmed (coordinator-context-prompt.ts). 24k characters is about 6k input tokens, about $0.002 a turn on gpt-4.1-mini.
const CONTEXT_CHARS = 24_000;

export async function availableCapabilities(slug: string): Promise<CapabilityId[]> {
  const environment = readCommonsRuntimeEnvironment();
  return ["answer", "retrieve_context", "prepare_poll", "record_attendance", "invite_people", "add_activities", "prepare_expense", "navigate_thread", "link_idea", ...(coordinatorTripChangesEnabled(slug) ? ["propose_trip_change" as const] : []), ...(await canUseCoordinatorSearch() && tavilyLookupConfigured(environment) ? ["research" as const] : []), ...(coordinatorSteeringEnabled() ? ["steer_task" as const] : [])];
}

/** Older rows have no stored capability; derive it from what the turn produced. */
export function capabilityOfRecord(record: CoordinatorTurnRecord): TurnCapability {
  const workspace = record.workspace;
  if (workspace?.capability) return workspace.capability;
  if (workspace?.tripProposal) return "propose_trip_change";
  if (workspace?.research) return "research";
  if (workspace?.proposal) return "prepare_poll";
  if (workspace?.attendanceReceipt) return "record_attendance";
  return "answer";
}

function artifactsOf(record: CoordinatorTurnRecord): TurnArtifactResult[] {
  const workspace = record.workspace, base = { id: record.turnId, threadId: record.threadId };
  const artifacts: TurnArtifactResult[] = [];
  if (workspace?.expenseReview) artifacts.push({ kind: "expense_review", id: workspace.expenseReview.planId, threadId: record.threadId, version: null, reviewRequired: true, undoable: false });
  if (workspace?.pollReview) artifacts.push({kind:"poll_draft",id:workspace.pollReview.draftId,threadId:record.threadId,version:workspace.pollReview.version,reviewRequired:false,undoable:false});
  if (workspace?.taskProposal) artifacts.push({ ...base, kind: "trip_task_proposal", version: workspace.taskProposal.version, reviewRequired: workspace.taskProposal.state === "pending", undoable: Boolean(workspace.taskProposal.quickAdd && workspace.taskProposal.state === "applied") });
  if (workspace?.tripProposal) artifacts.push({ ...base, kind: "trip_change_proposal", version: workspace.tripProposal.version, reviewRequired: workspace.tripProposal.state === "pending", undoable: false });
  // The private organizer draft prepared (or edited) by an Ask the group turn. Publication is a separate, explicit step.
  if (record.draftId && capabilityOfRecord(record) === "prepare_poll" && (!workspace?.tripConversation || workspace.proposal)) artifacts.push({ kind: "poll_draft", id: record.draftId, threadId: record.threadId, version: workspace?.proposal?.baseVersion ?? null, reviewRequired: true, undoable: false });
  if (workspace?.proposal) artifacts.push({ ...base, kind: "draft_edit_proposal", version: workspace.proposal.baseVersion, reviewRequired: workspace.proposal.state === "pending", undoable: false });
  if (workspace?.research) artifacts.push({ ...base, kind: "research_run", version: null, reviewRequired: false, undoable: false });
  if (workspace?.itineraryDraft) artifacts.push({ ...base, kind: "itinerary_draft", id: workspace.itineraryDraft.id, version: workspace.itineraryDraft.version, reviewRequired: true, undoable: false });
  if (workspace?.attendanceReceipt) artifacts.push({ ...base, kind: "attendance_receipt", version: null, reviewRequired: false, undoable: !workspace.attendanceReceipt.undone });
  if (workspace?.linkedIdea) artifacts.push({ kind: "linked_idea", id: workspace.linkedIdea.linkId, threadId: record.threadId, version: null, reviewRequired: false, undoable: false });
  // The thread this turn created. It always carries the ORIGIN thread id: the receipt lives where the request was made.
  if (workspace?.navigation?.kind === "created") artifacts.push({ kind: "thread", id: workspace.navigation.threadId, threadId: record.threadId, version: null, reviewRequired: false, undoable: false });
  return artifacts;
}

/** Maps a persisted turn to the wire result. Status comes from the record, never from model prose. */
export function turnResultFromRecord(record: CoordinatorTurnRecord): TurnResult {
  const artifacts = artifactsOf(record), completed = record.status === "completed";
  return TurnResultSchema.parse({
    commandId: record.commandId, status: record.status, turnId: record.turnId,
    thread: { id: record.thread.id, title: record.thread.title, turnVersion: record.thread.turnVersion, metadataVersion: record.thread.metadataVersion },
    spokenReply: completed ? record.spokenReply ?? spokenSummary(record.assistantText ?? "") : null,
    durableAnswer: completed ? record.assistantText : null,
    capability: completed ? capabilityOfRecord(record) : null,
    sources: completed ? record.sources : [], artifacts, reviewRequired: artifacts.some(artifact => artifact.reviewRequired),
    navigation: completed ? record.workspace?.navigation ?? null : null,
    saved: { request: true, answer: completed, proposal: artifacts.some(artifact => artifact.kind === "trip_change_proposal" || artifact.kind === "trip_task_proposal" || artifact.kind === "draft_edit_proposal" || artifact.kind === "itinerary_draft") },
    shared: false,
    error: record.status === "failed" ? coordinatorError(record.errorCode ?? "internal_error") : null,
  });
}

function initialTitle(command: TurnCommand) {
  const starter = command.explicitAction?.kind === "ask_group" && command.explicitAction.starterId && command.explicitAction.starterId !== "question" ? coordinatorStarter(command.explicitAction.starterId).label : null;
  return starter ?? provisionalTitle(command.text);
}

/** Milliseconds per server phase, for the turn metric. `firstText` is provider dispatch to the first streamed reply text (null when nothing streamed). */
type PhaseTimings = { auth: number; reserve: number; context: number; dispatch: number; firstText: number | null; firstVisible: number | null; commit: number };
type TurnMetrics = { capability: string; modelTier: string; outcome: string; contextMs: number; providerMs: number; contextChars: number; truncated: boolean; model: string | null; phases: PhaseTimings; streamed: boolean;
  detail: DispatchResult["detail"] | null;
  /** Milliseconds of the native lodging resolver call when one was made on this turn (null when none was): resolver plus answer cost is measurable. */
  lodgingResolver?: number | null };

function logTurn(record: CoordinatorTurnRecord | null, command: TurnCommand, startedAt: number, status: string, errorCode: string | null, metrics: TurnMetrics) {
  // Fixed fields only: no transcript, prompt, context, query text, or model output. Voice ids correlate a delegation with its session.
  console.info("commons.coordinator.turn", {
    turnId: record?.turnId ?? null, commandId: command.commandId, threadId: record?.threadId ?? null, inputMode: command.inputMode,
    voiceSessionId: command.voice?.sessionId ?? null, delegationId: command.voice?.delegationId ?? null,
    capability: metrics.capability, modelTier: metrics.modelTier, outcome: metrics.outcome, status, errorCode, attempt: record?.attempt ?? null,
    latencyMs: { total: Date.now() - startedAt, provider: metrics.providerMs, ...metrics.phases }, streamed: metrics.streamed,
    firstVisibleTextMs: metrics.phases.firstVisible ?? (status === "completed" ? Date.now() - startedAt : null),
    completionOnlyReply: status === "completed" && !metrics.streamed,
    reasoning: metrics.model && /^(?:openai\/)?gpt-6-luna$/.test(metrics.model) ? "none" : null,
    contextChars: metrics.contextChars, contextTruncated: metrics.truncated, model: metrics.model,
    sourceCount: metrics.detail?.sourceCount ?? 0, retrievedThreads: metrics.detail?.retrievedThreads ?? 0, researchQueryChars: metrics.detail?.researchQueryChars ?? null,
    executionMs: { model: metrics.detail?.modelMs ?? null, research: metrics.detail?.researchMs ?? null, validation: metrics.detail?.validationMs ?? null },
    navigation: metrics.detail?.navigation ?? null, unsupportedReason: metrics.detail?.unsupportedReason ?? null,
    lodgingResolverMs: metrics.lodgingResolver ?? null,
    // Which inference policy served the turn (and its table version); OpenRouter's data policy applies only under `best`.
    inferencePolicy: readCommonsRuntimeEnvironment().COMMONS_COORDINATOR_INFERENCE_POLICY, policyVersion: COORDINATOR_POLICY_VERSION,
    providerPolicy: readCommonsRuntimeEnvironment().COMMONS_COORDINATOR_INFERENCE_POLICY === "best" ? readCommonsRuntimeEnvironment().COMMONS_COORDINATOR_PROVIDER_POLICY : null,
  });
}

const NO_STEER_DETAIL = { retrievedThreads: 0, researchQueryChars: null, sourceCount: 0, navigation: null, unsupportedReason: null };
/** A steering outcome as a turn result: code-written text, a receipt in the saved workspace, no sources and no artifacts. */
function steeredResult(steered: SteerOutcome): DispatchResult {
  return { capability: "steer_task", modelTier: steered.modelCalled ? "extraction" : "none", assistantText: steered.assistantText, spokenReply: steered.spokenReply, workspace: { steering: steered.steering },
    data: null, attendanceStatement: false, topicTitle: null, threadSummary: null, openQuestions: null, sources: [], model: steered.model, providerMs: steered.providerMs, detail: NO_STEER_DETAIL };
}

/** Fixed fields only: which path decided and what happened. No message, brief, task title, or traveler data. */
function logSteering(command: TurnCommand, threadId: string, steered: SteerOutcome) {
  console.info("commons.coordinator.steering", { commandId: command.commandId, threadId, inputMode: command.inputMode, via: steered.via, outcome: steered.outcome, taskCount: steered.taskCount, modelCalled: steered.modelCalled, classifyMs: steered.providerMs });
}

/** A short label for what the turn did, for dashboards: never derived from content. */
function outcomeLabel(result: DispatchResult) {
  if (result.capability === "unsupported") return "unsupported";
  if (result.capability === "steer_task") return "steering";
  if (result.capability === "answer" && result.detail.unsupportedReason) return "answered_with_limit_notice";
  if (result.capability === "navigate_thread") return result.detail.navigation ?? "navigation";
  if (result.capability === "retrieve_context" && result.detail.navigation === "reference_clarify") return "clarification";
  if (result.capability === "record_attendance" || result.capability === "add_activities") return "direct_change";
  return result.workspace.tripProposal || result.workspace.taskProposal || result.workspace.itineraryDraft || result.workspace.proposal || result.newDraft ? "proposal" : result.workspace.research ? "evidence" : "answered";
}

export async function runCoordinatorTurn(slug: string, rawCommand: unknown, dependencies: Partial<CoordinatorTurnDependencies> = {}): Promise<TurnResult> {
  const command = TurnCommandSchema.parse(rawCommand);
  const startedAt = Date.now(), now = dependencies.now?.();
  const phases: PhaseTimings = { auth: 0, reserve: 0, context: 0, dispatch: 0, firstText: null, firstVisible: null, commit: 0 };
  const researchQuery = command.explicitAction?.kind === "research" ? command.explicitAction.query : undefined;
  await coordinatorWorkspaceEnabled(slug); // authenticates before anything else is revealed
  if (command.attachments?.length && readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED !== "true") throw new CoordinatorTurnError("unsupported_capability");
  phases.auth = Date.now() - startedAt;
  // Nothing is saved when Commons cannot answer at all: direct editing stays available and the message is not consumed.
  const steeringOn = coordinatorSteeringEnabled() || await coordinatorGoalsAvailableFor(slug);
  // Commons-native lodging (default off, allowlisted trips): a typed lodging request is read by code here, but it is only handled after the shared router
  // below has passed over it. An explicit request needs no model, so it is neither refused for lack of one nor counted against the hourly allowance.
  const lodgingOn = process.env.COMMONS_NATIVE_LODGING_ENABLED?.trim() === "true"
    ? await nativeLodgingSelected(slug, (await authenticatedCoordinationOptions(slug)).actorPersonId) : false;
  const lodgingText = lodgingOn && command.inputMode === "text" && !command.explicitAction && !command.attachments?.length && !isModelFreeRequest(command.text, command.explicitAction, true, readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED === "true") ? lodgingRequest(command.text) : null;
  const lodgingClaim = lodgingText && lodgingText !== "conversation" ? lodgingText : null;
  // Choosing a task is answered from the database; it needs no model, so it must not be refused for lack of one.
  if (command.explicitAction?.kind !== "task_control" && !lodgingClaim && !coordinatorProviderReady(command.text, researchQuery, true).ok) throw new CoordinatorProviderError("provider_not_configured");

  const reserveStarted = Date.now();
  const execution = dependencies.durable?.mode === "execute" ? dependencies.durable : null, admitting = dependencies.durable?.mode === "admit" ? dependencies.durable : null;
  // Operators (COMMONS_OPERATOR_EMAIL_ALLOWLIST) are not limited, and their turns do not use up the trip's hourly allowance. A durable execution keeps
  // what the admitting request derived from verified authentication: its hourly slot was reserved (or not) then, with the same key.
  const operator = execution ? execution.admission.operator : await (dependencies.isOperator ?? isCommonsOperatorRequest)();
  // A potential refinement can be recognized before loading its draft. Reserve
  // the longer lease conservatively; this flag does not select a capability.
  const itineraryGeneration = execution ? execution.admission.itineraryGeneration : !command.explicitAction && readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED === "true" && !tripTaskOperation(command.text) && Boolean(itineraryOperation(command.text, true));
  // An explicit lodging request reserves nothing here. If it later needs a model (the resolver, or the shared path after the router passes it elsewhere), the
  // same slot is reserved then with the same key, so one logical attempt counts once whichever path it takes.
  const reserve = execution ? execution.admission.reserve : !operator && !lodgingClaim && !isModelFreeRequest(command.text, command.explicitAction, true, readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED === "true");
  let kind: "started" | "replayed", turn: CoordinatorTurnRecord;
  if (execution) {
    // The runner claimed this attempt; the turn already exists. Anything other than this exact pending attempt is reported as saved, never re-run.
    const found = await findAuthenticatedCoordinatorTurn(slug, command.commandId);
    if (!found) throw new CoordinatorTurnError("artifact_missing");
    if (found.turnId !== execution.claim.turnId || found.status !== "pending" || found.attempt !== execution.claim.attempt) return turnResultFromRecord(found);
    kind = "started"; turn = found;
  } else {
    ({ kind, turn } = await beginAuthenticatedCoordinatorTurn(slug, command, initialTitle(command), now, reserve, itineraryGeneration,
      admitting ? { v: 1, command: command as unknown as Record<string, unknown>, admission: { authUserId: admitting.authUserId, operator, reserve, itineraryGeneration, provisionalTitle: initialTitle(command).slice(0, 200) } } : undefined));
  }
  phases.reserve = Date.now() - reserveStarted;
  // Durable admission ends here: the saved request and its execution row committed together; the runner does the rest.
  if (admitting) { dependencies.onAccepted?.({ turnId: turn.turnId, threadId: turn.threadId, replayed: kind === "replayed" }); return turnResultFromRecord(turn); }
  const claimToken = execution ? { execution: { token: execution.claim.token } } : {};
  dependencies.onAccepted?.({ turnId: turn.turnId, threadId: turn.threadId, replayed: kind === "replayed" });
  let trace: InferenceTrace | undefined;
  try { trace = await (dependencies.traceFactory ?? coordinatorInferenceTrace)(dependencies.request, {
    tripId: turn.tripId, actorId: turn.actorId, commandId: command.commandId, threadId: turn.threadId, attempt: turn.attempt,
  }, startedAt, kind === 'replayed'); } catch { /* Analytics failures do not consume or fail an authorized turn. */ }
  trace?.set({ inputMode: command.inputMode, policyVersion: COORDINATOR_POLICY_VERSION, codeRevision: process.env.VERCEL_GIT_COMMIT_SHA });
  trace?.begin('auth', {}, startedAt).finish('completed', {}, startedAt + phases.auth);
  trace?.begin('reserve', {}, reserveStarted).finish('completed', {}, reserveStarted + phases.reserve);
  // Replaying reads the receipt; it must not create another generation or pretend to execute its original steps.
  if (kind === "replayed") { trace?.finish('replayed'); return turnResultFromRecord(turn); }
  // Reserves this attempt's hourly slot when the turn did not at begin, with the begin key; reserving twice for one attempt is a no-op.
  const ensureReserved = async () => { if (!operator && !reserve) await reserveAuthenticatedTurnInference(slug, { commandId: command.commandId, attempt: turn.attempt }); };
  const execute = async (): Promise<TurnResult> => {
    const metrics: TurnMetrics = { capability: "answer", modelTier: "none", outcome: "pending", contextMs: 0, providerMs: 0, contextChars: 0, truncated: false, model: null, phases, streamed: false, detail: null };
    // Work stops for a Stop, a deadline, or (on the JSON route) a client that went away; they are recorded differently below.
    const deadline = new AbortController(), limits = { ...turnDeadlines(command.explicitAction?.kind === "itinerary" || itineraryGeneration), ...dependencies.deadlines };
    const signals = [dependencies.signal, dependencies.stopSignal, deadline.signal].filter((item): item is AbortSignal => Boolean(item));
    const workSignal = AbortSignal.any(signals);
    let deadlineHit: TurnDeadlineError | null = null, idleTimer: ReturnType<typeof setTimeout> | undefined;
    let rejectDeadline!: (error: TurnDeadlineError) => void;
    const deadlineReached = new Promise<never>((_, reject) => { rejectDeadline = reject; });
    deadlineReached.catch(() => undefined);
    const expire = (kind: "hard" | "idle") => { if (deadlineHit) return; deadlineHit = new TurnDeadlineError(kind); deadline.abort(deadlineHit); rejectDeadline(deadlineHit); };
    const deadlineAt = Date.now() + Math.max(1, limits.hardMs);
    const hardTimer = setTimeout(() => expire("hard"), Math.max(1, limits.hardMs));
    // The idle limit starts with the first streamed text and restarts with each later piece.
    const touchIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(() => expire("idle"), Math.max(1, limits.idleMs)); };
    // Before a consequential operation that commits on its own: this attempt must still be live here and in the database (a Stop on another instance).
    const fence = async () => {
      workSignal.throwIfAborted();
      if (!await authenticatedTurnAttemptIsLive(slug, { commandId: command.commandId, attempt: turn.attempt })) throw new TurnFencedError();
      workSignal.throwIfAborted();
    };
    let activeSpan: ReturnType<InferenceTrace['begin']> | undefined;
    try {
      dependencies.onPhase?.("context");
      const contextStarted = Date.now();
      activeSpan = trace?.begin('context');
      const flags = { tripChangesEnabled: coordinatorTripChangesEnabled(slug), researchConfigured: tavilyLookupConfigured(readCommonsRuntimeEnvironment()) };
      const thread = await loadAuthenticatedCoordinatorThread(slug, undefined, turn.threadId);
      const ownTravelRequest = /\b(my|mine|i entered|i added|we land|we arrive)\b/i;
      // Short follow-ups retain the requesting organizer's own travel scope in this conversation only.
      const lastOwnRequest = thread.turns.filter(item => item.authorPersonId === turn.actorId && item.id !== turn.turnId).at(-1)?.userText ?? "";
      const includeOwnTravel = ownTravelRequest.test(command.text) || (/^(yes|use mine|you have it|after we land|i added it)[.! ]*$/i.test(command.text.trim()) && ownTravelRequest.test(lastOwnRequest));
      const [snapshot, tripChangeContext] = await Promise.all([
        loadAuthenticatedTripContext(slug, { activeThreadId: turn.threadId, includeOwnTravel, capabilities: await availableCapabilities(slug), ...(now ? { now } : {}) }),
        flags.tripChangesEnabled ? authenticatedTripChangeContext(slug) : Promise.resolve(undefined),
      ]);
      const rendered = renderTripContextForModel(snapshot, { maxChars: CONTEXT_CHARS, focusThreadId: turn.threadId });
      metrics.contextMs = phases.context = Date.now() - contextStarted; metrics.contextChars = rendered.json.length; metrics.truncated = rendered.truncated;
      // A subthread's starting brief, attributed to who wrote it, is context for its conversation only (never for the main conversation or another subthread).
      let threadBrief: DispatchInput["threadBrief"];
      const artifactOperation = readCommonsRuntimeEnvironment().COMMONS_ASSISTANT_UI_ENABLED === "true" && !command.explicitAction &&
        (tripTaskOperation(command.text) || itineraryOperation(command.text, thread.turns.some(item => item.workspace?.itineraryDraft)));
      if (steeringOn && command.explicitAction?.kind !== "itinerary" && !artifactOperation) {
        const brief = (await authenticatedThreadRelations(slug)).find(item => item.threadId === turn.threadId && item.kind === "sub")?.brief;
        if (brief) threadBrief = { writtenBy: thread.threads.find(item => item.id === turn.threadId)?.createdByName ?? "An organizer", text: brief.slice(0, 1000) };
      }
      const goalContext = await goalConversationContext(slug, turn.threadId, snapshot);
      if (goalContext) threadBrief = { writtenBy: "Saved task state", text: goalContext };
      const draft = turn.draftId ? thread.drafts.find(item => item.id === turn.draftId) ?? null : null;
      if (turn.draftId && !draft) throw new CoordinatorTurnError("artifact_missing");
      activeSpan?.finish('completed', { contextChars: rendered.json.length, contextTruncated: rendered.truncated, sourceCount: rendered.sources.length });
      activeSpan = undefined;
      trace?.set({ contextChars: rendered.json.length, contextTruncated: rendered.truncated });

      // From here work may reach a provider: a lost durable attempt is interrupted, never reclaimed (A06).
      if (execution && !await execution.onProviderStart()) throw new TurnFencedError();
      const dispatchStarted = Date.now();
      let attachmentRows: Awaited<ReturnType<typeof readCoordinatorSources>> = [];
      let sourceNotice: string | undefined;
      try {
        if (command.attachments?.length) attachmentRows = await readCoordinatorSources(slug, command.attachments, await authenticatedGoalOptions(slug), command);
        assembleCoordinatorSources(command.explicitAction?.kind === "itinerary" ? command.explicitAction.importText : undefined,
          attachmentRows.map(row => ({ filename: row.filename, text: row.extractedText, limitations: row.limitations })));
      } catch (error) {
        if (error instanceof CommandAccessError) sourceNotice = "An attached source is unavailable in this conversation or has expired. Remove it and reattach the file here. Your request is saved; no trip items were changed or shared.";
        else if (error instanceof CommandConflictError || error instanceof CoordinatorSourceBudgetError) sourceNotice = "The selected sources exceed the supported size. Remove a source or attach a smaller file. Nothing was truncated, added to Plan or shared.";
        else throw error;
      }
      const dispatchInput: DispatchInput = {
        slug, prompt: command.text, ...(sourceNotice ? { sourceNotice } : {}), ...(attachmentRows.length ? { attachedSources: attachmentRows.map(row => ({ filename: itineraryModelText(row.filename), text: itineraryModelText(row.extractedText), limitations: row.limitations })) } : {}), commandId: command.commandId, inputMode: command.inputMode, ...(command.explicitAction ? { explicitAction: command.explicitAction } : {}),
        contextKey: `thread:${turn.threadId}`, thread, threadId: turn.threadId, currentTurnId: turn.turnId, currentTurnAttempt: turn.attempt, draft,
        idSeed: derivedIdSeed(turn.tripId, turn.actorId, command.commandId), ...(threadBrief ? { threadBrief } : {}),
        // The client attaches a thread's unpublished goal draft to every turn as context; only a draft the organizer chose in the UI is 'selected' for routing.
        draftSelected: Boolean(draft) && !(command.artifact?.kind === "draft" && command.artifact.selection === "thread_context"),
        contextPollId: turn.contextPollId ?? undefined, context: { snapshot, ...rendered },
        // A generated topic title is only ever asked for on the thread's first turn, and only while the thread still has its provisional title.
        wantTopicTitle: turn.sequence === 1 && turn.thread.titleSource === "provisional", wantThreadSummary: true,
        ...(tripChangeContext ? { tripChangeContext } : {}),
        ...(dependencies.request ? { request: dependencies.request } : {}), ...(workSignal ? { signal: workSignal } : {}),
        ...(dependencies.onPhase ? { onPhase: dependencies.onPhase } : {}),
        // Late text from work that already overran is never shown. Only a streamed reply has an idle limit; the hard limit covers the rest.
        ...(dependencies.onReplyDelta ? { onReplyDelta: (text: string) => { if (deadlineHit) return; touchIdle(); metrics.streamed = true; dependencies.onReplyDelta!(text); }, onFirstText: (ms: number) => { phases.firstText = ms; phases.firstVisible = Date.now() - startedAt; } } : {}),
        ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}), ...(dependencies.infer ? { infer: dependencies.infer } : {}), ...(dependencies.research ? { research: dependencies.research } : {}),
        ...(dependencies.inferItinerary ? { inferItinerary: dependencies.inferItinerary } : {}),
        ...(dependencies.readExcerpt ? { readExcerpt: dependencies.readExcerpt } : {}),
      };
      // Continuity: while tasks are live, a plain message may be a status question, a correction or a cancellation of one of the organizer's own tasks.
      // Off by default; when it is off, or when the message is ordinary conversation, nothing here changes the merged path.
      const { intent, result } = await Promise.race([deadlineReached, withInferenceSpan('dispatch', async () => {
        if (sourceNotice) return routeAndDispatch(dispatchInput, flags);
        const routed = await withInferenceSpan('routing', async () => routeIntentFor(dispatchInput, flags), { routeReason: command.explicitAction ? 'explicit_action' : 'deterministic_intent' });
        if (includeOwnTravel && routed.capability === "prepare_poll" && draft?.data.questions.some(question => question.kind === "choice" && question.itinerary)) {
          const shared = await loadAuthenticatedTripContext(slug, { activeThreadId: turn.threadId, includeOwnTravel: false, capabilities: await availableCapabilities(slug), ...(now ? { now } : {}) });
          dispatchInput.context = { snapshot: shared, ...renderTripContextForModel(shared, { maxChars: CONTEXT_CHARS, focusThreadId: turn.threadId }) };
        }
        // Native lodging answers only what the shared router left for an ordinary answer or a request-derived lookup. Its resolver sees only lodging-scoped
        // messages; everything else continues below unchanged.
        if (lodgingOn && lodgingText !== "conversation" && lodgingMayHandle(routed)) {
          const native = await runNativeLodgingTurn(slug, { turn, request: lodgingClaim, threadTurns: thread.turns, tripChangesEnabled: flags.tripChangesEnabled,
            resolverAllowed: lodgingModelResolveEnabled() && coordinatorProviderReady(command.text, researchQuery, true).ok,
            reserveResolverInference: ensureReserved, ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}), ...(workSignal ? { signal: workSignal } : {}) });
          metrics.lodgingResolver = native.resolverCalled ? native.resolverMs : null;
          if (native.result) return { intent: { capability: native.result.workspace.capability ?? "answer" } as unknown as Awaited<ReturnType<typeof routeAndDispatch>>["intent"], result: {
            capability: native.result.workspace.capability ?? "answer", modelTier: native.resolverCalled ? "extraction" : "none", assistantText: native.result.assistantText, spokenReply: spokenSummary(native.result.assistantText),
            workspace: native.result.workspace, data: null, attendanceStatement: false, topicTitle: null, threadSummary: null, openQuestions: null, sources: native.result.sources, model: null,
            providerMs: native.resolverMs, detail: NO_STEER_DETAIL } as Awaited<ReturnType<typeof routeAndDispatch>>["result"] };
        }
        // Read as a lodging request but handled elsewhere: that path may call a model, so it holds this attempt's slot first.
        if (lodgingClaim) await ensureReserved();
        let steered: SteerOutcome | null = null;
        if (steeringOn && command.explicitAction?.kind !== "itinerary") {
          // The question "which task?" is still open only if it was asked in the previous completed turn.
          const previous = thread.turns.filter(item => item.id !== turn.turnId && (item.status === undefined || item.status === "completed")).at(-1)?.workspace?.steering;
          steered = await steerTurn({ slug, command, threadId: turn.threadId, intent: routed, snapshot, inputMode: command.inputMode, pendingClarification: previous?.kind === "clarify" ? previous : null }, { ...dependencies.steering, signal: workSignal, beforeOperation: fence, turnFence: { commandId: command.commandId, attempt: turn.attempt, deadlineAt, ...claimToken }, ...(dependencies.fetcher ? { fetcher: dependencies.fetcher } : {}) });
          if (steered) logSteering(command, turn.threadId, steered);
        }
        if (steered) return { intent: { capability: "steer_task" } as unknown as Awaited<ReturnType<typeof routeAndDispatch>>["intent"], result: steeredResult(steered) };
        // Never let a partial protected core masquerade as complete model context.
        // Explicit itinerary construction uses its own narrower, bounded projection.
        if (rendered.budgetExceeded && command.explicitAction?.kind !== "itinerary") {
          const answer = "There are more saved trip details than fit in this reply. Your records are unchanged. You can review them in Plan or open the relevant task.";
          return { intent: { capability: "answer" } as unknown as Awaited<ReturnType<typeof routeAndDispatch>>["intent"], result: {
            capability: "answer", modelTier: "none", assistantText: answer, spokenReply: answer, workspace: { tripConversation: true }, data: null,
            attendanceStatement: false, topicTitle: null, threadSummary: null, openQuestions: null, sources: [], model: null, providerMs: 0,
            detail: { retrievedThreads: 0, researchQueryChars: null, sourceCount: 0, navigation: null, unsupportedReason: "context_scope" },
          } as Awaited<ReturnType<typeof routeAndDispatch>>["result"] };
        }
        return await routeAndDispatch(dispatchInput, flags, routed);
      })]);
      clearTimeout(hardTimer); clearTimeout(idleTimer);
      if (deadlineHit) throw deadlineHit;
      phases.dispatch = Date.now() - dispatchStarted;
      // A Stop that arrives after the reply was written but before it is saved still stops it: nothing was committed yet.
      dependencies.stopSignal?.throwIfAborted();
      dependencies.onCommitting?.();
      dependencies.onPhase?.("saving");
      const commitStarted = Date.now();
      Object.assign(metrics, { capability: intent.capability, modelTier: result.modelTier, providerMs: result.providerMs, model: result.model, detail: result.detail, outcome: outcomeLabel(result) });
      trace?.set({ capability: result.capability, modelTier: result.modelTier, sourceCount: result.sources.length });
      activeSpan = trace?.begin('commit');

      const workspace: CoordinatorWorkspace = { ...result.workspace, ...(result.capability !== "answer" ? { capability: result.capability === "unsupported" ? "unsupported" as const : result.capability } : {}) };
      const update = { ...(result.topicTitle ? { topicTitle: result.topicTitle } : {}), ...(result.threadSummary ? { summary: result.threadSummary } : {}), ...(result.openQuestions && result.threadSummary ? { openQuestions: result.openQuestions } : {}) };
      const saved = await completeAuthenticatedCoordinatorTurn(slug, { turnId: turn.turnId, commandId: command.commandId, attempt: turn.attempt, ...(now ? { now } : {}), ...claimToken,
        outcome: { status: "completed", assistantText: result.assistantText, spokenReply: result.spokenReply, sources: result.sources, workspace,
          attendanceStatement: result.attendanceStatement, ...(Object.keys(update).length ? { threadUpdate: update } : {}),
          ...(result.privateItineraryEdit ? { privateItineraryEdit: result.privateItineraryEdit } : {}), ...(result.newDraft ? { newDraft: result.newDraft } : {}), ...(result.createThread ? { createThread: result.createThread } : {}), ...(result.linkIdea ? { linkIdea: result.linkIdea } : {}) } });
      phases.commit = Date.now() - commitStarted;
      activeSpan?.finish(saved.status === 'failed' ? 'failed' : 'completed', { ...(saved.errorCode ? { errorCode: saved.errorCode } : {}) });
      activeSpan = undefined;
      if (saved.status === "failed") metrics.outcome = "failed";
      logTurn(saved, command, startedAt, saved.status, saved.errorCode, metrics);
      // The durable queue and receipt already committed together. Delivery uses the same fenced,
      // idempotent sender as People; cron can finish it if this request ends before delivery.
      if (saved.status === "completed" && saved.workspace?.invitationReceipt?.length && readCommonsRuntimeEnvironment().COMMONS_EMAIL_SEND_MODE !== "disabled") {
        await withInferenceSpan('delivery', () => Promise.all(saved.workspace!.invitationReceipt!.map(async recipient => {
          if (!recipient.deliveryAttemptId) return;
          try { await processInvitationDelivery(recipient.deliveryAttemptId, commonsSiteOrigin()); }
          catch { /* Durable queued attempts remain available to the invitation delivery worker. */ }
        })));
      }
      const response = turnResultFromRecord(saved);
      trace?.finish(saved.status === 'failed' ? 'failed' : 'completed', { outcome: result.capability === 'navigate_thread' ? 'navigation' : metrics.outcome, firstTextMs: phases.firstText, artifactCount: response.artifacts.length, reviewRequired: response.reviewRequired, ...(saved.errorCode ? { errorCode: saved.errorCode } : {}) });
      return response;
    } catch (error) {
      clearTimeout(hardTimer); clearTimeout(idleTimer);
      activeSpan?.finish(workSignal?.aborted ? 'cancelled' : 'failed', { errorCode: coordinatorErrorCode(error) });
      // Overran its limit: recorded as interrupted (an unfinished reply for older readers) at once, not when the work that ignored its signal returns.
      if (deadlineHit) {
        metrics.outcome = `deadline_${(deadlineHit as TurnDeadlineError).kind}`;
        const interrupted = await interruptAuthenticatedCoordinatorTurn(slug, { turnId: turn.turnId, commandId: command.commandId, attempt: turn.attempt, reason: "deadline", ...(now ? { now } : {}), ...claimToken });
        logTurn(interrupted, command, startedAt, interrupted.status, interrupted.errorCode, metrics);
        trace?.finish('failed', { outcome: metrics.outcome, errorCode: interrupted.errorCode ?? "provider_failed", firstTextMs: phases.firstText });
        return turnResultFromRecord(interrupted);
      }
      // The client went away (JSON route): leave the turn pending. Lookup reports it, and the lease bounds how long it can look in flight.
      if (dependencies.signal?.aborted && !dependencies.stopSignal?.aborted) { logTurn(turn, command, startedAt, "pending", null, metrics); trace?.finish('pending', { outcome: 'pending' }); return turnResultFromRecord(turn); }
      // A Stop is recorded as an unfinished reply (provider_failed: "couldn't finish that reply ... Try again"), so Try again works at once. No new stored
      // code is introduced, because rows written here are also read by the version before this one.
      if (dependencies.stopSignal?.aborted) metrics.outcome = "stopped";
      // Provider, parsing, and validation failures after the request was saved are provider_failed (the request
      // stays visible and retryable); known access/version/auth codes keep their own meaning.
      const mapped = coordinatorErrorCode(error);
      const code: CoordinatorErrorCode = mapped === "invalid_request" || mapped === "internal_error" ? "provider_failed" : mapped;
      const failed = await withInferenceSpan('failure_commit', () => failAuthenticatedCoordinatorTurn(slug, { turnId: turn.turnId, commandId: command.commandId, attempt: turn.attempt, errorCode: code, ...(now ? { now } : {}), ...claimToken }));
      if (metrics.outcome !== "stopped") metrics.outcome = "failed";
      logTurn(failed, command, startedAt, failed.status, failed.errorCode, metrics);
      trace?.finish(dependencies.stopSignal?.aborted ? 'cancelled' : 'failed', { outcome: metrics.outcome, errorCode: failed.errorCode ?? code, firstTextMs: phases.firstText });
      return turnResultFromRecord(failed);
    }
  };
  try { return await (trace ? trace.run(execute) : execute()); }
  catch (error) { trace?.finish('failed', { outcome: 'failed', errorCode: coordinatorErrorCode(error) }); throw error; }
}

/** Reload/timeout recovery: what happened to this command, without repeating it. */
export async function lookupCoordinatorTurn(slug: string, commandId: string): Promise<TurnResult | null> {
  const record = await findAuthenticatedCoordinatorTurn(slug, commandId);
  return record ? turnResultFromRecord(record) : null;
}
