import { canUseCoordinatorBackgroundResearch } from "./coordinator-search-access";
import { authenticatedGoalParticipantEvidence } from "./participant-questions";
import { participantQuestionsEnabled } from "./runtime-environment";
import { authenticatedBrain, tripBrainEnabled } from "./trip-brain-service";
import { goalEnvelope, coordinatorNextSteps, travelNextStepDescriptor } from "@commons/domain";
import { loadCommonsSnapshot } from "./commons";
import { authenticatedIntakes, confirmationIntakeEnabled } from "./confirmation-intake";
import { GoalOperationRequestSchema, type GoalOperationRequest, type TripContextSnapshot } from "@commons/contracts";
import { type CoordinatorTurnFence, CoordinatorTurnError, researchWorkerHealthy, goalSuggestions, listCoordinatorGoals, operateCoordinatorGoal } from "@commons/database";
import { authenticatedGoalOptions, authenticatedThreadRelations, loadAuthenticatedTripContext } from "@/lib/server/polls";
import { coordinatorTasksAvailable } from "@/lib/server/runtime-environment";
import { coordinatorGoalsAvailableFor } from "./goal-access";
import { resolveTripCapabilities } from "./trip-capabilities";
import { sanitizeTypedResearchQuery } from "@/lib/server/coordinator-research-query";
import { boundedGoalContext } from "../goal-context-projection";
import { goalEvidenceProjection } from "../goal-evidence-projection";

/** Thrown for a goal operation that needs the general Coordinator (research, a chat-made proposal) on a trip without it. Routes answer with the stable capability_unavailable response. */
export class GoalCapabilityUnavailableError extends Error { constructor() { super("capability_unavailable"); } }
/** Operations that run research or depend on a conversation turn. Direct goal work (objective, polls, questions, decisions, cancel, reopen) never does. */
export function goalOperationNeedsCoordinator(input: GoalOperationRequest) {
  if (input.op === "link_proposal") return true;
  if (input.op === "start") return input.kind === "research" || input.kind === "plan_action" || input.then.length > 0 || Boolean(input.query);
  return "query" in input && Boolean(input.query);
}
export async function authenticatedGoals(slug: string) {
  if (!await coordinatorGoalsAvailableFor(slug)) return { goals: [], reports: [], suggestions: [] };
  const options = await authenticatedGoalOptions(slug);
  // Without the general Coordinator no research runs, so no worker health check or Plan-idea task suggestions are needed.
  const direct = !(await resolveTripCapabilities(slug)).coordinator;
  const result = await listCoordinatorGoals(slug, { ...options, researchAvailable: !direct && await canUseCoordinatorBackgroundResearch() && coordinatorTasksAvailable() && await researchWorkerHealthy(options.databaseUrl) });
  return { ...result, suggestions: direct ? [] : await goalSuggestions(slug, options) };
}
export async function authenticatedGoalOperation(slug: string, raw: unknown, turnFence?: CoordinatorTurnFence) {
  const input: GoalOperationRequest = GoalOperationRequestSchema.parse(raw);
  if (!await coordinatorGoalsAvailableFor(slug) && input.op !== "cancel") throw new CoordinatorTurnError("invalid_request");
  const direct = !(await resolveTripCapabilities(slug)).coordinator;
  if (direct && goalOperationNeedsCoordinator(input)) throw new GoalCapabilityUnavailableError();
  if(input.op === "start")try{goalEnvelope(input);}catch{throw new CoordinatorTurnError("invalid_request");}
  const options = await authenticatedGoalOptions(slug);
  if ((input.op === "start" && input.kind === "research") || ("query" in input && input.query)) {
    if (!await canUseCoordinatorBackgroundResearch()) throw new CoordinatorTurnError("unsupported_capability");
    const safe = sanitizeTypedResearchQuery(input.op === "start" ? input.query || input.goal.slice(0, 500) : "query" in input ? input.query ?? "" : "", await loadAuthenticatedTripContext(slug));
    if (!safe) throw new CoordinatorTurnError("invalid_request");
    if ("query" in input) input.query = safe.query;
  }
  return operateCoordinatorGoal(slug, input, { ...options, turnFence, researchAvailable: !direct && await canUseCoordinatorBackgroundResearch() && coordinatorTasksAvailable() && await researchWorkerHealthy(options.databaseUrl) });
}

/** Main sees concise authorized goals and reports; a task sees only its brief and relevant outcome. */
export async function goalConversationContext(slug: string, threadId: string, tripContext: TripContextSnapshot): Promise<string | null> {
  if (!await coordinatorGoalsAvailableFor(slug)) return null;
  const { goals, reports } = await authenticatedGoals(slug);
  const snapshot = await loadCommonsSnapshot(slug);
  const intakes = confirmationIntakeEnabled() ? await authenticatedIntakes(slug) : [];
  const nextSteps = snapshot ? coordinatorNextSteps({commons:snapshot.commons,state:snapshot.state,participants:snapshot.participants,personId:snapshot.currentActor.id,now:Date.now(),travelState:"loaded",intakes,uploadAvailable:true}).steps.map(travelNextStepDescriptor) : [];
  const selected = goals.find(goal => goal.threadId === threadId);
  if (selected) {
    // Conversation durability lane B: a traveler's explicitly shared answer to this task's question, attributed and labelled as reported evidence.
    const travelerAnswers = participantQuestionsEnabled() ? await authenticatedGoalParticipantEvidence(slug, selected.goalId).catch(() => []) : [];
    return boundedGoalContext({ goal: { title: selected.title, brief: selected.goal, finishLine: selected.completionCriterion, status: selected.lifecycle, waitingFor: selected.waitDetail, revision: selected.revision, ideaIds:selected.ideaIds, linkedPlanFacts:tripContext.plans.filter(fact=>selected.ideaIds.includes(fact.value.itemId)).map(fact=>({id:fact.value.itemId,title:fact.value.title,status:fact.value.status,startsAt:fact.value.startsAt,version:fact.version})), ...goalEvidenceProjection(selected), ...(travelerAnswers.length ? { travelerAnswers } : {}) }, authority: `A recommendation is not permission. Historical outcomes are not current evidence; explicitly review or reopen outdated work. Current saved facts and existing reviewed commands remain authoritative.${travelerAnswers.length ? " travelerAnswers are what that traveler reported for this task: attribute them, never treat them as saved travel details or Plan facts, and propose any change for review." : ""}` }, 5000);
  }
  if (!(await authenticatedThreadRelations(slug)).some(relation=>relation.threadId === threadId && relation.kind === "main")) return null;
  const brain = tripBrainEnabled() ? await authenticatedBrain(slug) : null;
  return boundedGoalContext({ nextSteps, tripReview:brain?.recommendations.map(r=>({finding:r.finding,todoId:r.todoId,earlierGoalId:r.goalId})), tasks: goals.slice(0, 12).map(goal => {
    const evidence = goalEvidenceProjection(goal);
    return { title: goal.title, goalId: goal.goalId, threadId: goal.threadId, status: goal.lifecycle, revision: goal.revision, waitingFor: goal.waitDetail,
      resultOutdated: evidence.resultOutdated, outcomeRevision: evidence.outcomeRevision, outcome: evidence.outcome?.headline ?? null, historicalOutcome: evidence.historicalOutcome?.headline ?? null };
  }), reports: reports.filter(report => !report.superseded).slice(0, 6), authority: "Answer directly when useful. Historical outcomes are not current evidence; explicitly review or reopen outdated work. These are stored tasks, not permission for new execution or trip writes." }, 6500);
}
