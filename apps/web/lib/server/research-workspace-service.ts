import { z } from "zod";
import { DecisionSourceSchema, ResearchDecisionBriefSchema, ResearchDecisionCheckpointSchema, ResearchDecisionComparisonSchema,
  type TripContextSnapshot, type ResearchDecisionBrief, type WorkflowJson } from "@commons/contracts";
import { CommandAccessError, CommandConflictError, type WorkflowRegistry, type WorkflowValidationScope,
  type startReviewedGoalWorkflow, type reviseReviewedGoalWorkflow, type readReviewedGoalWorkflow, type readGoalWorkflowArtifact } from "@commons/database";
import { ResearchDecisionReviewRequestSchema, prepareResearchDecisionReview } from "./research-decision-review";
import { SavedResearchDecisionInputSchema } from "./research-decision-input";
import { RESEARCH_DECISION_RECIPES } from "./research-decision-workflow";
import { TransportDecisionAnswersSchema } from "./research-decision-context";
import { sameTransportAnswers, transportAnswerSummary, unknownTransportAnswers } from "../research-transport-answers";

/** The browser chooses inputs, never models, tools, scope snapshots or authority. */
export const ResearchWorkspacePrepareSchema = ResearchDecisionReviewRequestSchema;
export const ResearchWorkspaceStartSchema = ResearchWorkspacePrepareSchema.extend({
  commandId: z.string().uuid(), expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
export type ResearchWorkspaceRequest = z.infer<typeof ResearchWorkspacePrepareSchema>;
export type ResearchWorkspaceStart = z.infer<typeof ResearchWorkspaceStartSchema>;
export const ResearchWorkspaceAnswerRequestSchema = z.object({ goalId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  expectedReviewCommandId: z.string().uuid(), answers: TransportDecisionAnswersSchema }).strict();
export const ResearchWorkspaceAnswerCommandSchema = ResearchWorkspaceAnswerRequestSchema.extend({ commandId: z.string().uuid(), expectedSourceFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
export type ResearchWorkspaceAnswerRequest = z.infer<typeof ResearchWorkspaceAnswerRequestSchema>;
export type ResearchWorkspaceAnswerCommand = z.infer<typeof ResearchWorkspaceAnswerCommandSchema>;
type BoundHistory = NonNullable<Awaited<ReturnType<typeof readReviewedGoalWorkflow>>>;
type GoalHistory = NonNullable<Awaited<ReturnType<typeof readGoalWorkflowArtifact>>>;
export type ResearchWorkspacePorts = {
  scope: () => Promise<{ context: TripContextSnapshot; actorId: string; registry: WorkflowRegistry; runnerHealthy: boolean }>;
  start: (input: Parameters<typeof startReviewedGoalWorkflow>[1], registry: WorkflowRegistry) => ReturnType<typeof startReviewedGoalWorkflow>;
  revise: (input: Parameters<typeof reviseReviewedGoalWorkflow>[1], registry: WorkflowRegistry) => ReturnType<typeof reviseReviewedGoalWorkflow>;
  command: (id: string, registry: WorkflowRegistry) => ReturnType<typeof readReviewedGoalWorkflow>;
  goal: (id: string, registry: WorkflowRegistry) => ReturnType<typeof readGoalWorkflowArtifact>;
};
export class ResearchWorkspaceUnavailable extends Error {}
export class ResearchWorkspaceAnswerUnchanged extends Error {}
const ref = (fact: { id: string; version: string | number }) => ({ id: fact.id, version: fact.version });
function authorized(scope: Awaited<ReturnType<ResearchWorkspacePorts["scope"]>>) {
  if (!scope.context.travelers.some(f => f.value.personId === scope.actorId && f.value.role === "organizer" && f.value.membership === "active")) throw new CommandAccessError();
  return scope;
}
function bounded(context: TripContextSnapshot) {
  if (context.travelers.length >= 60 || context.stays.length >= 10 || context.logistics.length >= 40 || context.plans.length >= 40) throw new CommandConflictError();
}
function prepare(raw: unknown, scope: Awaited<ReturnType<ResearchWorkspacePorts["scope"]>>) {
  const request = ResearchWorkspacePrepareSchema.parse(raw), recipe = RESEARCH_DECISION_RECIPES.find(r => r.key === `${request.request.kind}-decision-v1`)!;
  // Preparation IDs are code-owned placeholders only. The atomic binder derives
  // real identity/policy pins; they cannot be supplied by the browser.
  const placeholder = "00000000-0000-4000-8000-000000000001";
  const pins: WorkflowValidationScope = { tripId: scope.context.tripId, actorId: scope.actorId, taskId: placeholder, threadId: placeholder, artifactId: placeholder,
    pins: { goalRevision: 1, briefRevision: 1, contextVersion: "review-preparation-only", recipe, policyVersion: "review-preparation-only" } };
  return { ...prepareResearchDecisionReview(request, scope.context, pins), request, recipe };
}
/** No source calls, SQL writes or funding exist in this preparation/read host.
 * The injected start port is exclusively the shared atomic human command. */
export function researchWorkspaceService(ports: ResearchWorkspacePorts) {
  const prepareAnswer = async (raw: unknown) => {
    const request = ResearchWorkspaceAnswerRequestSchema.parse(raw), scope = authorized(await ports.scope());
    const prior = await ports.goal(request.goalId, scope.registry);
    if (!prior || !prior.ownedByMe || prior.goalId !== request.goalId || prior.currentGoalRevision !== request.expectedRevision
      || prior.execution.pins.inputReview?.commandId !== request.expectedReviewCommandId) throw new CommandConflictError();
    const history = researchWorkspaceHistory(prior);
    if (!history.canRefineTransport) throw new CommandConflictError();
    const saved = SavedResearchDecisionInputSchema.parse(prior.execution.input);
    if (saved.savedContext.request.kind !== "transport") throw new CommandConflictError();
    if (sameTransportAnswers(saved.savedContext.request.answers ?? unknownTransportAnswers, request.answers)) throw new ResearchWorkspaceAnswerUnchanged();
    const prepared = prepare({ selection: saved.savedContext.selection, request: { ...saved.savedContext.request, answers: request.answers } }, scope);
    return { request, prior, scope, prepared };
  };
  return {
    async prepareAnswer(raw: unknown) {
      const { request, scope, prepared } = await prepareAnswer(raw);
      return { request, plan: prepared.input.plan, sourceFingerprint: prepared.input.savedContext.sourceFingerprint,
        summary: transportAnswerSummary(request.answers), availability: scope.registry.length && scope.runnerHealthy ? "fixture_ready" as const : "unavailable" as const };
    },
    async answer(raw: unknown) {
      const { commandId, expectedSourceFingerprint, ...request } = ResearchWorkspaceAnswerCommandSchema.parse(raw);
      const { prior, scope, prepared } = await prepareAnswer(request);
      if (!scope.runnerHealthy || !scope.registry.length) throw new ResearchWorkspaceUnavailable();
      if (prepared.input.savedContext.sourceFingerprint !== expectedSourceFingerprint) throw new CommandConflictError();
      const result = await ports.revise({ commandId, goalId: request.goalId, expectedRevision: request.expectedRevision,
        expectedStepId: prior.stepId, expectedReviewCommandId: request.expectedReviewCommandId, answer: transportAnswerSummary(request.answers),
        binding: { handler: prior.execution.handler, recipe: prepared.recipe, artifactId: prior.execution.artifact.id,
          input: prepared.input as unknown as Record<string, WorkflowJson> } }, scope.registry);
      return { goalId: result.goalId, stepId: result.stepId, commandId };
    },
    async choices() {
      const scope = authorized(await ports.scope()), c = scope.context; bounded(c);
      return { actorId: scope.actorId, availability: scope.registry.length && scope.runnerHealthy ? "fixture_ready" as const : "unavailable" as const,
        trip: { destination: c.trip.value.destination, startsOn: c.trip.value.startsOn, endsOn: c.trip.value.endsOn, timezone: c.trip.value.timezone },
        people: c.travelers.map(f => ({ ...ref(f), name: f.value.name, eligible: f.value.membership === "active" && f.value.attendance === "attending",
          attendance: f.value.attendance, membership: f.value.membership, attendanceDates: f.value.attendanceDates })),
        stays: c.stays.filter(f => f.value.status !== "considering").map(f => ({ ...ref(f), name: f.value.name, startsOn: f.value.startsOn, endsOn: f.value.endsOn, status: f.value.status })),
        flights: c.logistics.filter(f => f.value.status !== "considering" && f.value.travelerIds.length > 0 && f.value.travelerIds.length < 20 && ["arrival", "departure"].includes(f.value.kind) && ["basic", "all"].includes(f.value.visibility ?? "")).map(f => ({ ...ref(f), kind: f.value.kind, date: f.value.date,
          endpoints: f.value.connections?.map(x => `${x.origin ?? "?"} → ${x.destination ?? "?"}`) ?? [] })),
      };
    },
    async prepare(raw: unknown) {
      const scope = authorized(await ports.scope()), prepared = prepare(raw, scope);
      return { request: prepared.request, plan: prepared.input.plan, sourceFingerprint: prepared.input.savedContext.sourceFingerprint,
        people: scope.context.travelers.filter(f => prepared.request.selection.party.some(r => r.id === f.id)).map(f => f.value.name),
        availability: scope.registry.length && scope.runnerHealthy ? "fixture_ready" as const : "unavailable" as const };
    },
    async start(raw: unknown) {
      const command = ResearchWorkspaceStartSchema.parse(raw), scope = authorized(await ports.scope());
      // A heartbeat without a registered handler, or a handler without a fresh
      // heartbeat, cannot enqueue work. Production registration remains empty.
      if (!scope.runnerHealthy || !scope.registry.length) throw new ResearchWorkspaceUnavailable();
      const prepared = prepare({ selection: command.selection, request: command.request }, scope);
      if (prepared.input.savedContext.sourceFingerprint !== command.expectedSourceFingerprint) throw new CommandConflictError();
      const handler = scope.registry.find(h => h.key === "fixture-saved-research-decision" && h.version === 1 && h.requiresReviewedInput === true);
      if (!handler) throw new ResearchWorkspaceUnavailable();
      const result = await ports.start({ goal: { op: "start", commandId: command.commandId, kind: "research", title: command.request.title,
        goal: `Compare ${command.request.kind} options for the explicitly selected trip party. References only; no booking, sharing or plan changes.`,
        query: command.request.queries[0].text, completionCriterion: "A sourced comparison or an explicit missing-input question." },
        binding: { handler: { key: handler.key, version: handler.version }, recipe: prepared.recipe, artifactId: command.commandId,
          input: prepared.input as unknown as Record<string, WorkflowJson> } }, scope.registry);
      return { goalId: result.goalId, stepId: result.stepId, commandId: command.commandId };
    },
    async command(commandId: string) {
      z.string().uuid().parse(commandId); const scope = authorized(await ports.scope());
      const history = await ports.command(commandId, scope.registry);
      return history ? researchWorkspaceHistory(history) : null;
    },
    async goal(goalId: string) {
      z.string().uuid().parse(goalId); const scope = authorized(await ports.scope());
      const history = await ports.goal(goalId, scope.registry);
      return history ? researchWorkspaceHistory(history) : null;
    },
  };
}
/** Browser gets the permission-filtered artifact, not reservations, lease IDs,
 * private full snapshots, raw task prose, audit internals or approval tokens. */
export function researchWorkspaceHistory(history: BoundHistory | GoalHistory) {
  const e = history.execution;
  if (e.artifact.kind !== "research_decision" || e.handler.key !== "fixture-saved-research-decision") throw new CommandAccessError();
  const input = SavedResearchDecisionInputSchema.parse(e.input);
  const comparison = e.comparison ? ResearchDecisionComparisonSchema.parse(e.comparison.value) : null;
  const checkpoint = e.checkpoint ? ResearchDecisionCheckpointSchema.parse(e.checkpoint.value) : null;
  const scope: ResearchDecisionBrief = ResearchDecisionBriefSchema.parse({ ...input.plan, taskId: comparison?.taskId ?? checkpoint?.taskId ?? "00000000-0000-4000-8000-000000000001",
    threadId: "threadId" in history ? history.threadId : comparison?.threadId ?? "00000000-0000-4000-8000-000000000001",
    ownerId: comparison?.ownerId ?? "00000000-0000-4000-8000-000000000001", revision: e.pins.briefRevision, contextRevision: e.pins.contextVersion,
    recipe: { key: e.pins.recipe.key, version: e.pins.recipe.version } });
  const refs = comparison?.sourceRefs ?? [];
  const sources = (checkpoint?.sources ?? []).filter(s => refs.some(r => r.runId === s.runId && r.sourceId === s.sourceId)).map(s => DecisionSourceSchema.parse(s));
  const stale = history.stale || history.sourceValidation !== "current" || history.inputReview !== "current";
  return { goalId: history.goalId, stepId: history.stepId, goalLifecycle: history.goalLifecycle, currentGoalRevision: history.currentGoalRevision, taskStatus: history.taskStatus,
    canRefineTransport: history.ownedByMe && !stale && input.plan.kind === "transport" && ["waiting_for_input", "completed"].includes(history.goalLifecycle)
      && ["needs_input", "ready"].includes(e.status),
    transportAnswers: input.savedContext.request.kind === "transport" ? input.savedContext.request.answers ?? unknownTransportAnswers : null,
    reviewCommandId: e.pins.inputReview?.commandId ?? null,
    executionStatus: e.status, stale,
    sourceValidation: history.sourceValidation, inputReview: history.inputReview, scope, comparison, sources,
    queries: input.plan.queries, calls: e.usage.calls, stages: e.usage.steps, booking: "not_booked" as const };
}
export type ResearchWorkspaceChoices = Awaited<ReturnType<ReturnType<typeof researchWorkspaceService>["choices"]>>;
export type ResearchWorkspaceReview = Awaited<ReturnType<ReturnType<typeof researchWorkspaceService>["prepare"]>>;
export type ResearchWorkspaceHistory = ReturnType<typeof researchWorkspaceHistory>;
export type ResearchWorkspaceAnswerReview = Awaited<ReturnType<ReturnType<typeof researchWorkspaceService>["prepareAnswer"]>>;
