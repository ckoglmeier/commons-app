import test from "node:test";
import assert from "node:assert/strict";
import { registerComponentImportStubs } from "../test-support/hook-harness";
registerComponentImportStubs();

test("canonical and legacy Goal endpoints share authenticated operation handlers", async () => {
  const canonical = await import("../../app/api/v1/commons/[slug]/goals/route");
  const legacy = await import("../../app/api/v1/commons/[slug]/coordinator/goals/route");
  assert.equal(canonical.GET, legacy.GET);
  assert.equal(canonical.POST, legacy.POST);
  assert.equal(canonical.PATCH, legacy.PATCH);
});

test("legacy recipe callers share the canonical Goal workflow functions and errors", async () => {
  const old = await import("./recipes");
  const current = await import("./goal-workflow-service");
  assert.equal(old.startAuthenticatedRecipeRun, current.startAuthenticatedGoalWorkflow);
  assert.equal(old.saveAuthenticatedRecipeAlternatives, current.saveAuthenticatedGoalWorkflowInputs);
  assert.equal(old.loadAuthenticatedRecipeRuns, current.loadAuthenticatedGoalWorkflows);
  assert.equal(old.loadAuthenticatedRecipeRun, current.loadAuthenticatedGoalWorkflow);
  assert.equal(old.archiveAuthenticatedRecipeDraft, current.archiveAuthenticatedGoalWorkflowDraft);
  assert.equal(old.adoptAuthenticatedRecipeAdvice, current.adoptAuthenticatedGoalAdvice);
  assert.equal(old.publishAuthenticatedRecipeRound, current.publishAuthenticatedGoalRound);
  assert.equal(old.reviseAuthenticatedRecipeRound, current.reviseAuthenticatedGoalRound);
  assert.equal(old.approveAuthenticatedRecipeOutcome, current.approveAuthenticatedGoalOutcome);
  assert.equal(old.applyAuthenticatedRecipeOutcome, current.applyAuthenticatedGoalOutcome);
  assert.equal(old.loadAuthenticatedTransportReview, current.loadAuthenticatedTransportReview);
  assert.equal(old.RecipesDisabledError, current.GoalWorkflowsDisabledError);
  assert.equal(old.recipeFailure, current.goalWorkflowFailure);
  assert.equal(current.goalWorkflowFailure(new old.RecipesDisabledError()).status, 404);
  assert.equal(current.goalWorkflowFailure(new Error("private details")).status, 503);
  assert.ok(!JSON.stringify(await current.goalWorkflowFailure(new Error("private details")).json()).includes("private details"));
});
