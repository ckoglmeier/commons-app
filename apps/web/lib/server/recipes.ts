/** Compatibility imports only. No second implementation or permission policy. */
export {
  GoalWorkflowsDisabledError as RecipesDisabledError,
  goalWorkflowFailure as recipeFailure,
  startAuthenticatedGoalWorkflow as startAuthenticatedRecipeRun,
  saveAuthenticatedGoalWorkflowInputs as saveAuthenticatedRecipeAlternatives,
  loadAuthenticatedGoalWorkflows as loadAuthenticatedRecipeRuns,
  archiveAuthenticatedGoalWorkflowDraft as archiveAuthenticatedRecipeDraft,
  loadAuthenticatedGoalWorkflow as loadAuthenticatedRecipeRun,
  adoptAuthenticatedGoalAdvice as adoptAuthenticatedRecipeAdvice,
  loadAuthenticatedTransportReview,
  publishAuthenticatedGoalRound as publishAuthenticatedRecipeRound,
  reviseAuthenticatedGoalRound as reviseAuthenticatedRecipeRound,
  approveAuthenticatedGoalOutcome as approveAuthenticatedRecipeOutcome,
  applyAuthenticatedGoalOutcome as applyAuthenticatedRecipeOutcome,
} from "./goal-workflow-service";
