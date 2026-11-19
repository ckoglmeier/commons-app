import "server-only";
import { readGoalWorkflowArtifact, readReviewedGoalWorkflow, workflowWorkerHealthy, startReviewedGoalWorkflow, reviseReviewedGoalWorkflow } from "@commons/database";
import { authenticatedGoalOptions, loadAuthenticatedTripContext } from "./polls";
import { researchWorkspaceService } from "./research-workspace-service";
import { researchWorkspaceFixtureAllowed, researchWorkspaceFixtureTrip, researchWorkspaceFixtureWorker } from "./research-workspace-fixture";

export function authenticatedResearchWorkspace(slug: string) {
  return researchWorkspaceService({
    scope: async () => {
      const options = await authenticatedGoalOptions(slug);
      const context = await loadAuthenticatedTripContext(slug, { includeOwnTravel: false });
      // Production has no registered domain worker. Local fixture opt-in is
      // capability-scoped again to the authorized canonical trip and actor.
      const fixture = researchWorkspaceFixtureAllowed(process.env) && context.tripId === researchWorkspaceFixtureTrip
        && options.actorPersonId === process.env.COMMONS_PILOT_ACTOR_ID;
      return { context, actorId: options.actorPersonId, registry: fixture ? [researchWorkspaceFixtureWorker(options.databaseUrl).contract] : [],
        runnerHealthy: fixture && await workflowWorkerHealthy({ key: "fixture-saved-research-decision", version: 1 }, options.databaseUrl) };
    },
    start: async (input, registry) => startReviewedGoalWorkflow(slug, input, await authenticatedGoalOptions(slug), registry),
    revise: async (input, registry) => reviseReviewedGoalWorkflow(slug, input, await authenticatedGoalOptions(slug), registry),
    command: async (id, registry) => readReviewedGoalWorkflow(slug, id, await authenticatedGoalOptions(slug), registry),
    goal: async (id, registry) => readGoalWorkflowArtifact(slug, id, await authenticatedGoalOptions(slug), registry),
  });
}
