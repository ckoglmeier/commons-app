import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { GoalOutcomeSchema, StartGoalRequestSchema, WorkflowPayloadSchema, WorkflowExecutionPinsSchema, WorkflowExecutionSchema, type GoalOutcome, type WorkflowExecution, type WorkflowExecutionPins, type WorkflowJson, type WorkflowArtifactRef } from "@commons/contracts";
import { createDatabase } from "./client";
import { commandFingerprint, runEventCommand, CommandAccessError, CommandConflictError, type CommandTransaction } from "./event-command";
import { requireTripOrganizer } from "./coordinator-turn-repository";
import { authorizeTaskActor, taskState, type ResearchOptions, type TaskLease } from "./research-task-repository";
import { ownsDeliveryLease } from "./delivery-lease";
import { auditEvents, processedCommands, commons, coordinatorGoals, coordinatorGoalSteps, coordinatorTaskEvents, coordinatorTaskState, researchAttempts, researchTasks } from "./schema";
import { operateCoordinatorGoalInTransaction, projectWorkflowGoalInTransaction } from "./coordinator-goal-repository";
import { workflowContextInTransaction } from "./workflow-execution-context";
import { workflowSavedContextInTransaction, frozenWorkflowValidationCopy, type WorkflowSavedContext } from "./workflow-saved-context";
export type { WorkflowSavedContext } from "./workflow-saved-context";

/** Code-owned registry entry, never accepted from a browser/model/template. The
 * empty production registry means this port cannot activate new capabilities.
 */
export type WorkflowHandlerContract = {
  key: string; version: number; artifactKind: WorkflowArtifactRef["kind"];
  recipes: WorkflowExecutionPins["recipe"][]; maxCalls: number; maxSteps: number;
  tools: Array<{ id: string; billing: "fixture" | "known_free" | "paid"; upperBoundCents: number }>;
  /** Code-owned opt-in. Schema-valid or source-current input is not human review. */
  requiresReviewedInput?: true;
  validateInput: (value: Record<string, WorkflowJson>, scope: WorkflowValidationScope) => boolean;
  validateCheckpoint: (value: Record<string, WorkflowJson>, scope: WorkflowValidationScope) => boolean;
  validateComparison: (value: Record<string, WorkflowJson>, scope: WorkflowValidationScope) => boolean;
  /** Code-owned synchronous source-seal validator, run under the trip lock.
   * No transaction, credentials or write handle is supplied to domain code. */
  validateSavedContext?: (value: Readonly<Record<string, WorkflowJson>>, scope: Readonly<WorkflowValidationScope>, context: Readonly<WorkflowSavedContext>) => boolean;
  completion: (execution: WorkflowExecution) => { question: string } | { outcome: GoalOutcome };
};
/** Domain validators receive canonical bindings rather than trusting IDs/pins
 * repeated inside their own payloads. They own the domain field interpretation.
 */
export type WorkflowValidationScope = { tripId: string; threadId: string; actorId: string; taskId: string; artifactId: string; pins: WorkflowExecutionPins };
export type WorkflowRegistry = readonly WorkflowHandlerContract[];
export class WorkflowExecutionConflict extends CommandConflictError {
  constructor(readonly reason: "stale_execution" | "budget_exhausted" | "uncertain_external_call" | "unsupported_handler") { super(); }
}
const handlerOf = (registry: WorkflowRegistry, handler: { key: string; version: number }) => {
  const entry = registry.find(h => h.key === handler.key && h.version === handler.version);
  if (!entry) throw new WorkflowExecutionConflict("unsupported_handler");
  return entry;
};
async function transaction<T>(databaseUrl: string | undefined, fn: (tx: CommandTransaction) => Promise<T>) {
  const db = createDatabase(databaseUrl); try { return await db.db.transaction(fn); } finally { await db.close(); }
}
function executionOf(value: Record<string, unknown> | null) { return WorkflowExecutionSchema.parse(value?.workflowExecution); }
const checksum = (value: unknown) => commandFingerprint("", "workflow-payload-v1", value);
const reviewAction = "workflow.input_reviewed";
const bindingSchema = z.object({
  stepId: z.string().uuid(), goalRevision: z.number().int().positive(),
  handler: WorkflowExecutionSchema.shape.handler, recipe: WorkflowExecutionPinsSchema.shape.recipe,
  artifactId: z.string().uuid(), input: WorkflowPayloadSchema,
  traceId: WorkflowExecutionSchema.shape.correlation.shape.traceId.unwrap().optional(),
}).strict();
type BindingInput = z.infer<typeof bindingSchema>;
type ReviewPin = NonNullable<WorkflowExecutionPins["inputReview"]>;
type ReviewValidation = "not_required" | "unavailable" | "missing" | "current" | "stale";
const reviewRecordSchema = z.object({ version: z.literal(1), type: z.literal("workflow_input_review"), tripId: z.string().uuid(), threadId: z.string().uuid(), actorId: z.string().uuid(),
  goalId: z.string().uuid(), stepId: z.string().uuid(), taskId: z.string().uuid(), artifact: WorkflowExecutionSchema.shape.artifact.omit({ revision: true }),
  handler: WorkflowExecutionSchema.shape.handler, pins: WorkflowExecutionPinsSchema.omit({ inputReview: true }), inputFingerprint: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
function reviewRecord(execution: WorkflowExecution, scope: WorkflowValidationScope, goalId: string, stepId: string) {
  const { inputReview: _review, ...pins } = execution.pins;
  return { version: 1, type: "workflow_input_review", tripId: scope.tripId, threadId: scope.threadId, actorId: scope.actorId,
    goalId, stepId, taskId: scope.taskId, artifact: { kind: execution.artifact.kind, id: scope.artifactId },
    handler: execution.handler, pins, inputFingerprint: checksum(execution.input) };
}
async function reviewAdopted(tx: CommandTransaction, tripId: string, goalId: string) {
  const [adopted] = await tx.select({ id: auditEvents.id }).from(auditEvents).innerJoin(coordinatorGoalSteps, eq(auditEvents.resourceId, sql`${coordinatorGoalSteps.id}::text`))
    .where(and(eq(auditEvents.commonsId, tripId), eq(coordinatorGoalSteps.commonsId, tripId), eq(coordinatorGoalSteps.goalId, goalId),
      eq(auditEvents.actorType, "human"), eq(auditEvents.action, reviewAction), eq(auditEvents.resourceType, "workflow_step"))).limit(1);
  return Boolean(adopted);
}
async function inspectInputReview(tx: CommandTransaction, handler: WorkflowHandlerContract, execution: WorkflowExecution, scope: WorkflowValidationScope, goalId: string, stepId: string): Promise<ReviewValidation> {
  const pin = execution.pins.inputReview;
  if (!pin) {
    if (handler.requiresReviewedInput) return "missing";
    // Review adoption cannot be undone by stripping a pin from a legacy handler.
    return await reviewAdopted(tx, scope.tripId, goalId) ? "missing" : "not_required";
  }
  const [receipt] = await tx.select({ result: processedCommands.result }).from(processedCommands)
    .where(and(eq(processedCommands.commonsId, scope.tripId), eq(processedCommands.commandId, pin.commandId)));
  const [audit] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.commonsId, scope.tripId),
    eq(auditEvents.commandId, pin.commandId), eq(auditEvents.actorId, scope.actorId), eq(auditEvents.actorType, "human"),
    eq(auditEvents.action, reviewAction), eq(auditEvents.resourceType, "workflow_step"), eq(auditEvents.resourceId, stepId)));
  if (!receipt || !audit) return "missing";
  const result = receipt.result.result as Record<string, unknown> | undefined;
  const record = reviewRecordSchema.safeParse(result?.review);
  return receipt.result.fingerprint === pin.fingerprint && record.success && checksum(record.data) === checksum(reviewRecord(execution, scope, goalId, stepId)) ? "current" : "stale";
}
async function validateInputReview(tx: CommandTransaction, handler: WorkflowHandlerContract, execution: WorkflowExecution, scope: WorkflowValidationScope, goalId: string, stepId: string) {
  const status = await inspectInputReview(tx, handler, execution, scope, goalId, stepId);
  if (status !== "current" && status !== "not_required") throw new WorkflowExecutionConflict("stale_execution");
}
function compatible(execution: WorkflowExecution, handler: WorkflowHandlerContract) {
  if (execution.artifact.kind !== handler.artifactKind || !handler.recipes.some(r => r.key === execution.pins.recipe.key && r.version === execution.pins.recipe.version && r.digest === execution.pins.recipe.digest)) throw new WorkflowExecutionConflict("unsupported_handler");
}
type SourceValidation = "not_required" | "unavailable" | "current" | "stale";
async function inspectSavedContext(tx: CommandTransaction, handler: WorkflowHandlerContract, execution: WorkflowExecution, scope: WorkflowValidationScope, now: Date): Promise<SourceValidation> {
  if (!handler.validateSavedContext) return "not_required";
  let saved: Readonly<WorkflowSavedContext>, value: Readonly<Record<string, WorkflowJson>>, frozenScope: Readonly<WorkflowValidationScope>;
  try {
    saved = frozenWorkflowValidationCopy(await workflowSavedContextInTransaction(tx, scope.tripId, scope.actorId, now));
    value = frozenWorkflowValidationCopy(execution.input); frozenScope = frozenWorkflowValidationCopy(scope);
  } catch { return "unavailable"; }
  try {
    const result: unknown = handler.validateSavedContext(value, frozenScope, saved);
    // Async predicates are unsupported, even if truthy. Drain a programming
    // error's rejection so it cannot become an unhandled worker exception.
    if (result instanceof Promise) void result.catch(() => undefined);
    return result === true ? "current" : "stale";
  } catch { return "stale"; }
}
async function validateSavedContext(tx: CommandTransaction, handler: WorkflowHandlerContract, execution: WorkflowExecution, scope: WorkflowValidationScope, now: Date) {
  const validation = await inspectSavedContext(tx, handler, execution, scope, now);
  if (validation !== "not_required" && validation !== "current") throw new WorkflowExecutionConflict("stale_execution");
}
async function totals(tx: CommandTransaction, goalId: string) {
  const rows = await tx.select({ result: coordinatorGoalSteps.result }).from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.goalId, goalId));
  const all = rows.filter(r => r.result?.workflowExecution).map(r => executionOf(r.result));
  return { calls: all.reduce((n, e) => n + e.usage.calls, 0), steps: all.reduce((n, e) => n + e.usage.steps, 0), cents: all.reduce((n, e) => n + e.usage.reservedCents, 0), all };
}

/** Bind only unclaimed, current, owner-started research work. Pins/bounds come
 * from canonical state plus the server registry; no paid authority is added.
 */
export async function bindGoalWorkflow(identifier: string, raw: BindingInput, options: ResearchOptions, registry: WorkflowRegistry) {
  // Legacy server adapters pass their whole code-owned contract as a descriptor.
  // Only its key/version select authority from the separately supplied registry.
  const input = frozenWorkflowValidationCopy(bindingSchema.parse({ ...raw, handler: { key: raw.handler.key, version: raw.handler.version } }));
  return transaction(options.databaseUrl, tx => bindInTransaction(tx, identifier, input, options, registry));
}
// The review capability exists only inside the common command transaction. No
// caller-supplied receipt, callback, SQL handle or direct bind can manufacture it.
async function bindInTransaction(tx: CommandTransaction, identifier: string, input: BindingInput, options: ResearchOptions, registry: WorkflowRegistry, review?: ReviewPin) {
  const handler = handlerOf(registry, input.handler);
  if (handler.requiresReviewedInput && !review) throw new CommandAccessError();
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const [step] = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.id, input.stepId), eq(coordinatorGoalSteps.commonsId, tripId))).for("update");
    const [goal] = step ? await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, step.goalId)).for("update") : [];
    if (!step || !goal || !goal.envelope.permitted.includes("research.public_sources") || goal.createdByPersonId !== options.actorPersonId || goal.revision !== input.goalRevision || step.goalRevision !== goal.revision || step.kind !== "research" || step.status !== "running" || !step.refId || goal.lifecycle !== "running") throw new CommandAccessError();
    const [task] = await tx.select().from(researchTasks).where(eq(researchTasks.id, step.refId)).for("update");
    const state = task && await taskState(tx, task.id);
    if (!task || !state || task.commonsId !== tripId || task.threadId !== goal.threadId || task.requestedByPersonId !== options.actorPersonId || task.status !== "pending" || task.attempts !== 0) throw new WorkflowExecutionConflict("stale_execution");
    await authorizeTaskActor(tx, tripId, task.threadId, options.actorPersonId);
    const context = await workflowContextInTransaction(tx, tripId), prior = await totals(tx, goal.id);
    const execution = WorkflowExecutionSchema.parse({ version: 1, revision: 1, handler: { key: input.handler.key, version: input.handler.version }, artifact: { kind: handler.artifactKind, id: input.artifactId, revision: 0 },
      pins: { goalRevision: goal.revision, briefRevision: state.revision, contextVersion: context.fingerprint, recipe: input.recipe, policyVersion: goal.envelope.modelPolicyVersion, ...(review ? { inputReview: review } : {}) }, input: input.input,
      checkpoint: null, comparison: null, checkpointChecksum: null, comparisonChecksum: null, status: "running", budget: {
        maxCalls: Math.min(goal.envelope.budget.maxToolCalls, handler.maxCalls, ...prior.all.map(e => e.budget.maxCalls)),
        maxSteps: Math.min(64, handler.maxSteps, ...prior.all.map(e => e.budget.maxSteps)), spendCents: 0,
        deadlineAt: new Date(Math.min(goal.createdAt.getTime() + goal.envelope.budget.maxDurationHours * 3600_000, ...prior.all.map(e => Date.parse(e.budget.deadlineAt)))).toISOString(),
      }, usage: { calls: 0, steps: 0, reservedCents: 0 }, reservations: [], correlation: { commandId: task.commandId, traceId: input.traceId ?? null } });
    compatible(execution, handler);
    const first = prior.all[0];
    if (!review && (prior.all.some(e => e.pins.inputReview) || await reviewAdopted(tx, tripId, goal.id))) throw new CommandAccessError();
    if (first && (first.handler.key !== execution.handler.key || first.handler.version !== execution.handler.version || first.artifact.id !== execution.artifact.id || first.artifact.kind !== execution.artifact.kind || JSON.stringify(first.pins.recipe) !== JSON.stringify(execution.pins.recipe))) throw new WorkflowExecutionConflict("unsupported_handler");
    const scope = { tripId, threadId: task.threadId, actorId: task.requestedByPersonId, taskId: task.id, artifactId: execution.artifact.id, pins: execution.pins };
    if (handler.validateInput(frozenWorkflowValidationCopy(execution.input), frozenWorkflowValidationCopy(scope)) !== true) throw new CommandConflictError();
    await validateSavedContext(tx, handler, execution, scope, new Date());
    if (step.result?.workflowExecution) {
      const previous = executionOf(step.result);
      if (checksum(previous) !== checksum(execution)) throw new CommandConflictError();
      return previous;
    }
    const result: Record<string, unknown> = { ...step.result, workflowExecution: execution }; delete result.workflowExecutionPending;
    await tx.update(coordinatorGoalSteps).set({ result }).where(eq(coordinatorGoalSteps.id, step.id));
    return execution;
}

/** Explicit organizer review of one existing unclaimed step. No source lookup,
 * query privacy approval, paid funding, booking or public handler activation. */
export async function reviewGoalWorkflow(identifier: string, raw: unknown, options: ResearchOptions, registry: WorkflowRegistry) {
  const input = frozenWorkflowValidationCopy(z.object({ commandId: z.string().uuid(), binding: bindingSchema }).strict().parse(raw));
  return reviewedCommand(identifier, input.commandId, input, options, registry, async () => input.binding);
}
/** Start + bind + receipt commit atomically, so an unbound job is never visible
 * to the legacy worker. Only one bounded research step is supported here. */
export async function startReviewedGoalWorkflow(identifier: string, raw: unknown, options: ResearchOptions, registry: WorkflowRegistry) {
  const input = frozenWorkflowValidationCopy(z.object({ goal: StartGoalRequestSchema, binding: bindingSchema.omit({ stepId: true, goalRevision: true }) }).strict().parse(raw));
  if (input.goal.kind !== "research" || input.goal.then.length) throw new CommandAccessError();
  return reviewedCommand(identifier, input.goal.commandId, input, options, registry, async tx => {
    // Generic goal prose is not the identity of a typed workflow brief. Different
    // selected parties/candidates/queries must not collide with an active brief.
    const started = await operateCoordinatorGoalInTransaction(tx, identifier, input.goal, { ...options, researchAvailable: true,
      reviewedWorkflowKey: checksum({ handler: input.binding.handler, recipe: input.binding.recipe, input: input.binding.input }) });
    const [step] = await tx.select({ id: coordinatorGoalSteps.id }).from(coordinatorGoalSteps).where(and(
      eq(coordinatorGoalSteps.goalId, started.goal.goalId), eq(coordinatorGoalSteps.goalRevision, started.goal.revision), eq(coordinatorGoalSteps.kind, "research")));
    if (!step) throw new CommandConflictError();
    return { ...input.binding, stepId: step.id, goalRevision: started.goal.revision };
  });
}
/** One approved refinement advances the existing goal and binds its new input
 * atomically. A failed bind cannot leave an answered but unreviewed revision. */
export async function reviseReviewedGoalWorkflow(identifier: string, raw: unknown, options: ResearchOptions, registry: WorkflowRegistry) {
  const input = frozenWorkflowValidationCopy(z.object({ commandId: z.string().uuid(), goalId: z.string().uuid(),
    expectedRevision: z.number().int().positive(), expectedStepId: z.string().uuid(), expectedReviewCommandId: z.string().uuid(),
    answer: z.string().trim().min(1).max(1000), binding: bindingSchema.omit({ stepId: true, goalRevision: true }),
  }).strict().parse(raw));
  return reviewedCommand(identifier, input.commandId, input, options, registry, async tx => {
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const prior = await readInTransaction(tx, tripId, input.expectedStepId, options, registry);
    const e = prior.history.execution;
    if (prior.goalId !== input.goalId || prior.ownerId !== options.actorPersonId || prior.goalRevision !== input.expectedRevision
      || prior.history.stale || !["waiting_for_input", "completed"].includes(prior.goalLifecycle)
      || !["needs_input", "ready"].includes(e.status) || e.pins.inputReview?.commandId !== input.expectedReviewCommandId
      || e.artifact.id !== input.binding.artifactId || checksum(e.handler) !== checksum(input.binding.handler)
      || checksum(e.pins.recipe) !== checksum(input.binding.recipe)) throw new WorkflowExecutionConflict("stale_execution");
    const handler = handlerOf(registry, e.handler); compatible(e, handler);
    await validateInputReview(tx, handler, e, prior.scope, input.goalId, input.expectedStepId);
    await validateSavedContext(tx, handler, e, prior.scope, new Date());
    const operation = prior.goalLifecycle === "completed"
      ? { op: "reopen" as const, note: input.answer }
      : { op: "answer" as const, answer: input.answer };
    const revised = await operateCoordinatorGoalInTransaction(tx, identifier, { ...operation, commandId: input.commandId,
      goalId: input.goalId, expectedRevision: input.expectedRevision }, { ...options, researchAvailable: true });
    const steps = await tx.select({ id: coordinatorGoalSteps.id }).from(coordinatorGoalSteps).where(and(
      eq(coordinatorGoalSteps.goalId, input.goalId), eq(coordinatorGoalSteps.goalRevision, revised.goal.revision), eq(coordinatorGoalSteps.kind, "research")));
    if (steps.length !== 1) throw new CommandConflictError();
    return { ...input.binding, stepId: steps[0].id, goalRevision: revised.goal.revision };
  });
}
async function reviewedCommand(identifier: string, commandId: string, commandInput: unknown, options: ResearchOptions, registry: WorkflowRegistry, binding: (tx: CommandTransaction) => Promise<BindingInput>) {
  const pin = { commandId, fingerprint: commandFingerprint(options.actorPersonId, reviewAction, commandInput) };
  return transaction(options.databaseUrl, async tx => {
    let authorizedTripId = "";
    const receipt = await runEventCommand(tx, { identifier, actorPersonId: options.actorPersonId, commandId, action: reviewAction, input: commandInput },
      context => { if (context.role !== "organizer") throw new CommandAccessError(); authorizedTripId = context.id; }, async () => {
        const input = await binding(tx), execution = await bindInTransaction(tx, identifier, input, options, registry, pin);
        const [step] = await tx.select().from(coordinatorGoalSteps).where(eq(coordinatorGoalSteps.id, input.stepId));
        const [goal] = await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, step.goalId));
        const scope = { tripId: step.commonsId, threadId: goal.threadId, actorId: options.actorPersonId, taskId: step.refId!, artifactId: execution.artifact.id, pins: execution.pins };
        return { result: { review: reviewRecord(execution, scope, goal.id, step.id) }, resourceType: "workflow_step", resourceId: step.id, summary: "Organizer reviewed a bounded workflow request. No booking or payment authorized." };
      });
    // Replay is permission checked above, then must still reference the exact
    // current input/binding. A receipt does not revive amended or cancelled work.
    const parsed = reviewRecordSchema.safeParse(receipt.review);
    if (!parsed.success || parsed.data.tripId !== authorizedTripId) throw new CommandConflictError();
    const [step] = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.id, parsed.data.stepId), eq(coordinatorGoalSteps.commonsId, authorizedTripId)));
    const [goal] = step ? await tx.select().from(coordinatorGoals).where(eq(coordinatorGoals.id, step.goalId)) : [];
    if (!step || !goal || goal.createdByPersonId !== options.actorPersonId || goal.revision !== step.goalRevision || goal.lifecycle !== "running" || step.status !== "running" || !step.refId) throw new WorkflowExecutionConflict("stale_execution");
    const execution = executionOf(step.result), handler = handlerOf(registry, execution.handler); compatible(execution, handler);
    if (execution.pins.inputReview?.commandId !== commandId || execution.pins.inputReview.fingerprint !== pin.fingerprint) throw new WorkflowExecutionConflict("stale_execution");
    const scope = { tripId: step.commonsId, threadId: goal.threadId, actorId: options.actorPersonId, taskId: step.refId, artifactId: execution.artifact.id, pins: execution.pins };
    await authorizeTaskActor(tx, scope.tripId, scope.threadId, scope.actorId);
    const state = await taskState(tx, scope.taskId);
    const [task] = await tx.select().from(researchTasks).where(eq(researchTasks.id, scope.taskId)).for("update");
    if (!state || state.revision !== execution.pins.briefRevision || !task || task.commonsId !== scope.tripId || task.threadId !== scope.threadId || task.requestedByPersonId !== scope.actorId
      || !["pending", "processing"].includes(task.status) || execution.pins.goalRevision !== goal.revision || execution.pins.policyVersion !== goal.envelope.modelPolicyVersion
      || handler.validateInput(frozenWorkflowValidationCopy(execution.input), frozenWorkflowValidationCopy(scope)) !== true) throw new WorkflowExecutionConflict("stale_execution");
    await validateInputReview(tx, handler, execution, scope, goal.id, step.id);
    if ((await workflowContextInTransaction(tx, scope.tripId)).fingerprint !== execution.pins.contextVersion) throw new WorkflowExecutionConflict("stale_execution");
    await validateSavedContext(tx, handler, execution, scope, new Date());
    return { goalId: goal.id, stepId: step.id, execution };
  });
}

async function current(tx: CommandTransaction, lease: TaskLease, registry: WorkflowRegistry, now: Date, checkContext = true) {
  await tx.select({ id: commons.id }).from(commons).where(eq(commons.id, lease.commonsId)).for("update");
  const [task] = await tx.select().from(researchTasks).where(eq(researchTasks.id, lease.taskId)).for("update");
  if (!task || task.commonsId !== lease.commonsId || task.threadId !== lease.threadId || task.requestedByPersonId !== lease.actorPersonId || !ownsDeliveryLease(task, lease.attempt, now)) throw new WorkflowExecutionConflict("stale_execution");
  await authorizeTaskActor(tx, task.commonsId, task.threadId, task.requestedByPersonId);
  const [attempt] = await tx.select().from(researchAttempts).where(and(eq(researchAttempts.id, lease.attemptId), eq(researchAttempts.taskId, task.id), eq(researchAttempts.attempt, lease.attempt), eq(researchAttempts.status, "processing")));
  const state = await taskState(tx, task.id);
  const rows = await tx.select({ step: coordinatorGoalSteps, goal: coordinatorGoals }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId))
    .where(and(eq(coordinatorGoalSteps.refId, task.id), eq(coordinatorGoalSteps.commonsId, task.commonsId), eq(coordinatorGoals.commonsId, task.commonsId), eq(coordinatorGoals.threadId, task.threadId)));
  const row = rows.find(r => r.step.goalRevision === r.goal.revision && r.step.status === "running" && r.goal.lifecycle === "running");
  if (!attempt || !state || state.revision !== lease.revision || !row || row.goal.createdByPersonId !== lease.actorPersonId) throw new WorkflowExecutionConflict("stale_execution");
  const execution = executionOf(row.step.result), handler = handlerOf(registry, execution.handler); compatible(execution, handler);
  const scope = { tripId: task.commonsId, threadId: task.threadId, actorId: task.requestedByPersonId, taskId: task.id, artifactId: execution.artifact.id, pins: execution.pins };
  if (checkContext && (!handler.validateInput(execution.input, scope) || execution.checkpoint && !handler.validateCheckpoint(execution.checkpoint.value, scope) || execution.comparison && !handler.validateComparison(execution.comparison.value, scope))) throw new WorkflowExecutionConflict("stale_execution");
  if (!row.goal.envelope.permitted.includes("research.public_sources") || execution.checkpointChecksum !== (execution.checkpoint ? checksum(execution.checkpoint) : null) || execution.comparisonChecksum !== (execution.comparison ? checksum(execution.comparison) : null)) throw new WorkflowExecutionConflict("stale_execution");
  const context = checkContext ? await workflowContextInTransaction(tx, task.commonsId) : { value: null, fingerprint: execution.pins.contextVersion };
  if (execution.pins.briefRevision !== state.revision || execution.pins.goalRevision !== row.goal.revision || execution.pins.policyVersion !== row.goal.envelope.modelPolicyVersion || checkContext && execution.pins.contextVersion !== context.fingerprint) throw new WorkflowExecutionConflict("stale_execution");
  if (checkContext) {
    await validateInputReview(tx, handler, execution, scope, row.goal.id, row.step.id);
    await validateSavedContext(tx, handler, execution, scope, now);
  }
  return { ...row, task, state, execution, handler, scope, context, totals: await totals(tx, row.goal.id) };
}
type Current = Awaited<ReturnType<typeof current>>;
async function write(tx: CommandTransaction, row: Current, patch: Partial<WorkflowExecution>) {
  const next = WorkflowExecutionSchema.parse({ ...row.execution, ...patch, revision: row.execution.revision + 1 });
  const [updated] = await tx.update(coordinatorGoalSteps).set({ result: { ...row.step.result, workflowExecution: next } })
    .where(and(eq(coordinatorGoalSteps.id, row.step.id), sql`${coordinatorGoalSteps.result}->'workflowExecution'->>'revision' = ${String(row.execution.revision)}`)).returning({ id: coordinatorGoalSteps.id });
  if (!updated) throw new WorkflowExecutionConflict("stale_execution");
  return next;
}
function checkRevision(row: Current, expectedRevision: number) { if (row.execution.revision !== expectedRevision) throw new WorkflowExecutionConflict("stale_execution"); }

export async function loadWorkflowExecution(lease: TaskLease, databaseUrl: string | undefined, registry: WorkflowRegistry, now = new Date()) {
  return transaction(databaseUrl, async tx => {
    const row = await current(tx, lease, registry, now);
    return { execution: row.execution, context: row.context, cumulative: { calls: row.totals.calls, steps: row.totals.steps, reservedCents: row.totals.cents,
      outstandingReservations: row.totals.all.reduce((n, e) => n + e.reservations.filter(r => r.status !== "completed").length, 0) } };
  });
}

/** Reserve the code-owned upper bound BEFORE the call. A lost/failed call keeps
 * its reservation; a subsequent lease cannot replay it automatically.
 */
export async function reserveWorkflowCall(lease: TaskLease, input: { expectedRevision: number; toolId: string; reservationId: string }, databaseUrl: string | undefined, registry: WorkflowRegistry, now = new Date()) {
  return transaction(databaseUrl, async tx => {
    const row = await current(tx, lease, registry, now), tool = row.handler.tools.find(t => t.id === input.toolId);
    checkRevision(row, input.expectedRevision);
    if (!tool || !Number.isSafeInteger(tool.upperBoundCents) || tool.upperBoundCents < 0) throw new CommandAccessError();
    if (row.totals.all.some(e => e.reservations.some(r => r.status === "uncertain" || r.status === "reserved" && r.attemptId !== lease.attemptId))) throw new WorkflowExecutionConflict("uncertain_external_call");
    if (row.execution.reservations.some(r => r.id === input.reservationId)) throw new WorkflowExecutionConflict("stale_execution");
    if (tool.billing === "paid" || row.totals.cents + tool.upperBoundCents > row.execution.budget.spendCents || row.totals.calls >= row.execution.budget.maxCalls || row.totals.steps >= row.execution.budget.maxSteps || now.getTime() >= Date.parse(row.execution.budget.deadlineAt)) throw new WorkflowExecutionConflict("budget_exhausted");
    return write(tx, row, { usage: { ...row.execution.usage, calls: row.execution.usage.calls + 1, reservedCents: row.execution.usage.reservedCents + tool.upperBoundCents },
      reservations: [...row.execution.reservations, { id: input.reservationId, toolId: tool.id, attemptId: lease.attemptId, status: "reserved", upperBoundCents: tool.upperBoundCents }] });
  });
}

export async function commitWorkflowCheckpoint(lease: TaskLease, input: { expectedRevision: number; checkpoint: WorkflowExecution["checkpoint"]; comparison?: WorkflowExecution["comparison"]; completedReservations?: string[] }, databaseUrl: string | undefined, registry: WorkflowRegistry, now = new Date()) {
  return transaction(databaseUrl, async tx => {
    const row = await current(tx, lease, registry, now); checkRevision(row, input.expectedRevision);
    if (!input.checkpoint || input.checkpoint.revision !== (row.execution.checkpoint?.revision ?? 0) + 1 || !row.handler.validateCheckpoint(input.checkpoint.value, row.scope)) throw new CommandConflictError();
    if (input.comparison && (input.comparison.revision !== (row.execution.comparison?.revision ?? 0) + 1 || !row.handler.validateComparison(input.comparison.value, row.scope))) throw new CommandConflictError();
    const completed = new Set(input.completedReservations ?? []);
    if (completed.size !== (input.completedReservations?.length ?? 0) || [...completed].some(id => !row.execution.reservations.some(r => r.id === id && r.attemptId === lease.attemptId && r.status === "reserved"))) throw new CommandConflictError();
    return write(tx, row, { checkpoint: input.checkpoint, checkpointChecksum: checksum(input.checkpoint), ...(input.comparison ? { comparison: input.comparison, comparisonChecksum: checksum(input.comparison), artifact: { ...row.execution.artifact, revision: input.comparison.revision } } : {}),
      reservations: row.execution.reservations.map(r => completed.has(r.id) ? { ...r, status: "completed" as const } : r) });
  });
}

/** One successful worker stage, not a goal success unless a validated comparison
 * has no blocking question. Completion uses the existing goal report path.
 */
export async function settleWorkflowStage(lease: TaskLease, input: { expectedRevision: number; action: "yield" | "complete" | "uncertain" } | { expectedRevision?: number; action: "failed" }, databaseUrl: string | undefined, registry: WorkflowRegistry, now = new Date()) {
  return transaction(databaseUrl, async tx => {
    const row = await current(tx, lease, registry, now, input.action !== "failed");
    if (input.expectedRevision !== undefined) checkRevision(row, input.expectedRevision);
    const pending = row.totals.all.some(e => e.reservations.some(r => r.status !== "completed"));
    const action = input.action === "failed" && pending ? "uncertain" : input.action;
    if (pending && !["uncertain", "failed"].includes(action)) throw new WorkflowExecutionConflict("uncertain_external_call");
    if ((row.totals.steps >= row.execution.budget.maxSteps || now.getTime() >= Date.parse(row.execution.budget.deadlineAt)) && !["failed", "uncertain"].includes(action)) throw new WorkflowExecutionConflict("budget_exhausted");
    if (action === "complete" && (!row.execution.comparison || !row.handler.validateComparison(row.execution.comparison.value, row.scope))) throw new CommandConflictError();
    const result = action === "complete" ? row.handler.completion(row.execution) : action === "uncertain" ? { question: "A research call may have completed before the worker stopped. Review the saved checkpoint before requesting another attempt." } : null;
    if (result && "outcome" in result) {
      const outcome = GoalOutcomeSchema.parse(result.outcome);
      if (!["research", "limited"].includes(outcome.kind) || outcome.receipt) throw new CommandAccessError();
    }
    const next = await write(tx, row, { status: action === "failed" ? "failed" : result ? "question" in result ? "needs_input" : "ready" : "running",
      usage: { ...row.execution.usage, steps: Math.min(64, row.execution.usage.steps + 1) },
      reservations: row.execution.reservations.map(r => r.status === "reserved" ? { ...r, status: "uncertain" as const } : r) });
    const status = action === "failed" ? "failed" : result ? "question" in result ? "needs_input" : "succeeded" : "pending";
    await tx.update(researchTasks).set({ status, leaseExpiresAt: null, availableAt: now, updatedAt: now, errorCode: action === "failed" ? "workflow_failed" : null }).where(eq(researchTasks.id, row.task.id));
    await tx.update(researchAttempts).set({ status: action === "failed" ? "failed" : "succeeded", finishedAt: now }).where(eq(researchAttempts.id, lease.attemptId));
    await tx.update(coordinatorTaskState).set({ needsInput: result && "question" in result ? result.question.slice(0, 400) : null, ...(status === "succeeded" ? { resultRevision: row.state.revision } : {}), updatedAt: now }).where(eq(coordinatorTaskState.taskId, row.task.id));
    if (result) await projectWorkflowGoalInTransaction(tx, row.step.id, result, now);
    if (action === "failed") await projectWorkflowGoalInTransaction(tx, row.step.id, { errorCode: "workflow_failed" }, now);
    if (status === "succeeded" || status === "failed") await tx.insert(coordinatorTaskEvents).values({ commonsId: row.task.commonsId, taskId: row.task.id, threadId: row.task.threadId, revision: row.state.revision, kind: status === "succeeded" ? "completed" : "failed" });
    return next;
  });
}

/** Organizer-readable private artifact history. No lease or mutation authority. */
export async function readGoalWorkflowExecution(identifier: string, stepId: string, options: ResearchOptions, registry?: WorkflowRegistry) {
  return transaction(options.databaseUrl, async tx => {
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId, Boolean(registry));
    return (await readInTransaction(tx, tripId, stepId, options, registry)).history;
  });
}

/** Read the latest bound artifact for a goal, without relying on browser-saved
 * step IDs. Current goal state is distinct from a historical execution. This
 * does not bind, claim, start, repair or resume any job. */
export async function readGoalWorkflowArtifact(identifier: string, goalId: string, options: ResearchOptions, registry?: WorkflowRegistry) {
  z.string().uuid().parse(goalId);
  return transaction(options.databaseUrl, async tx => {
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const [goal] = await tx.select().from(coordinatorGoals).where(and(eq(coordinatorGoals.commonsId, tripId), eq(coordinatorGoals.id, goalId)));
    if (!goal) throw new CommandAccessError();
    await authorizeTaskActor(tx, tripId, goal.threadId, options.actorPersonId, false);
    const steps = await tx.select().from(coordinatorGoalSteps).where(and(eq(coordinatorGoalSteps.commonsId, tripId), eq(coordinatorGoalSteps.goalId, goalId)));
    const step = steps.filter(s => s.result?.workflowExecution).sort((a, b) => b.goalRevision - a.goalRevision || a.seq - b.seq)[0];
    if (!step) return null;
    const read = await readInTransaction(tx, tripId, step.id, options, registry);
    return { goalId, threadId: goal.threadId, ownedByMe: goal.createdByPersonId === options.actorPersonId, stepId: step.id, goalLifecycle: read.goalLifecycle,
      currentGoalRevision: read.goalRevision, taskStatus: read.taskStatus, ...read.history };
  });
}

/** Read-only recovery after a lost start response. The caller already knows its
 * review command UUID; no new command/job, lease or execution permission results.
 * Trip serialization may wait for an in-flight command; absent receipts after
 * that wait return null, never permission to mint a new ID. */
export async function readReviewedGoalWorkflow(identifier: string, commandId: string, options: ResearchOptions, registry?: WorkflowRegistry) {
  z.string().uuid().parse(commandId);
  return transaction(options.databaseUrl, async tx => {
    const tripId = await requireTripOrganizer(tx, identifier, options.actorPersonId);
    const [receipt] = await tx.select({ result: processedCommands.result }).from(processedCommands).where(and(eq(processedCommands.commonsId, tripId), eq(processedCommands.commandId, commandId)));
    if (!receipt) return null;
    const result = receipt.result.result as Record<string, unknown> | undefined, parsed = reviewRecordSchema.safeParse(result?.review);
    if (!parsed.success || parsed.data.tripId !== tripId || parsed.data.actorId !== options.actorPersonId) throw new CommandAccessError();
    const [audit] = await tx.select({ id: auditEvents.id }).from(auditEvents).where(and(eq(auditEvents.commonsId, tripId), eq(auditEvents.commandId, commandId),
      eq(auditEvents.actorId, options.actorPersonId), eq(auditEvents.actorType, "human"), eq(auditEvents.action, reviewAction), eq(auditEvents.resourceType, "workflow_step"), eq(auditEvents.resourceId, parsed.data.stepId)));
    if (!audit) throw new CommandAccessError();
    const read = await readInTransaction(tx, tripId, parsed.data.stepId, options, registry), execution = read.history.execution;
    if (read.ownerId !== options.actorPersonId || execution.pins.inputReview?.commandId !== commandId || execution.pins.inputReview.fingerprint !== receipt.result.fingerprint
      || checksum(parsed.data) !== checksum(reviewRecord(execution, read.scope, read.goalId, parsed.data.stepId))) throw new CommandConflictError();
    return { goalId: read.goalId, ownedByMe: true, stepId: parsed.data.stepId, goalLifecycle: read.goalLifecycle, currentGoalRevision: read.goalRevision, taskStatus: read.taskStatus, ...read.history };
  });
}

async function readInTransaction(tx: CommandTransaction, tripId: string, stepId: string, options: ResearchOptions, registry?: WorkflowRegistry) {
    const [row] = await tx.select({ step: coordinatorGoalSteps, goal: coordinatorGoals }).from(coordinatorGoalSteps).innerJoin(coordinatorGoals, eq(coordinatorGoals.id, coordinatorGoalSteps.goalId))
      .where(and(eq(coordinatorGoalSteps.id, stepId), eq(coordinatorGoalSteps.commonsId, tripId), eq(coordinatorGoals.commonsId, tripId)));
    if (!row) throw new CommandAccessError();
    await authorizeTaskActor(tx, tripId, row.goal.threadId, options.actorPersonId, false);
    const execution = executionOf(row.step.result), superseded = row.step.goalRevision !== row.goal.revision;
    const state = row.step.refId ? await taskState(tx, row.step.refId) : null;
    const [task] = row.step.refId ? await tx.select().from(researchTasks).where(eq(researchTasks.id, row.step.refId)) : [];
    const taskChanged = !task || !state || state.revision !== execution.pins.briefRevision || task.commonsId !== tripId || task.threadId !== row.goal.threadId
      || task.requestedByPersonId !== row.goal.createdByPersonId || ["failed", "cancelled"].includes(task.status);
    let contextChanged = true;
    try { contextChanged = (await workflowContextInTransaction(tx, tripId)).fingerprint !== execution.pins.contextVersion; } catch (error) { if (!(error instanceof CommandConflictError)) throw error; }
    let sourceChanged = false;
    let sourceValidation: SourceValidation = "unavailable";
    let inputReview: ReviewValidation = "unavailable";
    if (registry) {
      try {
        const handler = handlerOf(registry, execution.handler); compatible(execution, handler);
        if (!row.step.refId) throw new WorkflowExecutionConflict("stale_execution");
        const scope = { tripId, threadId: row.goal.threadId, actorId: row.goal.createdByPersonId, taskId: row.step.refId, artifactId: execution.artifact.id, pins: execution.pins };
        inputReview = await inspectInputReview(tx, handler, execution, scope, row.goal.id, row.step.id);
        sourceValidation = await inspectSavedContext(tx, handler, execution, scope, new Date());
        sourceChanged = sourceValidation !== "not_required" && sourceValidation !== "current";
      } catch { sourceChanged = true; }
    }
    return { goalId: row.goal.id, ownerId: row.goal.createdByPersonId, goalLifecycle: row.goal.lifecycle, goalRevision: row.goal.revision, taskStatus: task?.status ?? null,
      scope: { tripId, threadId: row.goal.threadId, actorId: row.goal.createdByPersonId, taskId: row.step.refId ?? "", artifactId: execution.artifact.id, pins: execution.pins },
      history: { execution, superseded, sourceValidation, inputReview, stale: superseded || taskChanged || contextChanged || sourceChanged || ["missing", "stale"].includes(inputReview) || ["failed", "cancelled"].includes(row.goal.lifecycle) } };
}
