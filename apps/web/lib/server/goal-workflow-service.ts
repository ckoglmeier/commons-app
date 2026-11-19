import "server-only";

/** Goal planning workflows share one authenticated command boundary. Preserve
 * persisted command names and workflow pins for compatibility and replay safety.
 */

import {
  CommandAccessError, CommandConflictError, PollRepositoryError, RecipeRunError,
  adoptRecipeAdvice, setRecipeDraftArchived, applyRecipeOutcome, approveRecipeOutcome, getRecipeRun, getTransportReview, listRecipeRuns, publishRecipeRound, reviseRecipeRound, saveRecipeInputs, startRecipeRun,
} from "@commons/database";
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { CommonsAuthenticationRequiredError, CommonsMembershipRequiredError } from "./commons";
import { recipesAvailableFor } from "./recipe-access";
import { authenticatedPollOptions } from "./polls";
import { coordinatorGoalsAvailableFor } from "./goal-access";

export class GoalWorkflowsDisabledError extends Error { constructor() { super("Goal workflows are not available yet."); } }

async function options(slug: string) {
  if (!await recipesAvailableFor(slug)) throw new GoalWorkflowsDisabledError();
  return authenticatedPollOptions(slug);
}
export async function startAuthenticatedGoalWorkflow(slug: string, input: unknown) { return startRecipeRun(slug, input, { ...await options(slug), createPlanningGoal: await coordinatorGoalsAvailableFor(slug) }); }
export async function saveAuthenticatedGoalWorkflowInputs(slug: string, runId: string, input: unknown) { return saveRecipeInputs(slug, runId, input, await options(slug)); }
export async function loadAuthenticatedGoalWorkflows(slug: string) { return listRecipeRuns(slug, await options(slug), true); }
export async function archiveAuthenticatedGoalWorkflowDraft(slug: string, runId: string, input: unknown) { return setRecipeDraftArchived(slug, runId, input, await options(slug)); }
export async function loadAuthenticatedGoalWorkflow(slug: string, runId: string) { return getRecipeRun(slug, runId, await options(slug)); }
export async function adoptAuthenticatedGoalAdvice(slug: string, runId: string, input: unknown) { return adoptRecipeAdvice(slug, runId, input, await options(slug)); }
export async function loadAuthenticatedTransportReview(slug: string, windowMinutes?: number) { return getTransportReview(slug, { ...await options(slug), windowMinutes }); }
export async function publishAuthenticatedGoalRound(slug: string, runId: string, input: unknown) { return publishRecipeRound(slug, runId, input, await options(slug)); }
export async function reviseAuthenticatedGoalRound(slug: string, runId: string, input: unknown) { return reviseRecipeRound(slug, runId, input, await options(slug)); }
export async function approveAuthenticatedGoalOutcome(slug: string, runId: string, input: unknown) { return approveRecipeOutcome(slug, runId, input, await options(slug)); }
export async function applyAuthenticatedGoalOutcome(slug: string, runId: string, input: unknown) { return applyRecipeOutcome(slug, runId, input, await options(slug)); }

/** Stable, non-leaking responses. Nothing here names another trip, person or record. */
export function goalWorkflowFailure(error: unknown) {
  if (error instanceof GoalWorkflowsDisabledError) return NextResponse.json({ error: error.message }, { status: 404 });
  if (error instanceof CommonsAuthenticationRequiredError) return NextResponse.json({ error: error.message }, { status: 401 });
  if (error instanceof CommonsMembershipRequiredError || error instanceof CommandAccessError) return NextResponse.json({ error: "Only an organizer of this trip can use goal workflows." }, { status: 403 });
  if (error instanceof RecipeRunError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.code === "run_not_found" ? 404 : 409 });
  if (error instanceof CommandConflictError) return NextResponse.json({ error: "This changed in another tab or was already used. Reload the saved version and try again.", code: "conflict" }, { status: 409 });
  if (error instanceof PollRepositoryError) return NextResponse.json({ error: error.message }, { status: error.code === "actor_not_authorized" ? 403 : 409 });
  if (error instanceof ZodError) return NextResponse.json({ error: error.issues[0]?.message ?? "Check the details and try again." }, { status: 400 });
  return NextResponse.json({ error: "Couldn’t confirm the result. Reload the saved goal workflow before trying again." }, { status: 503 });
}
