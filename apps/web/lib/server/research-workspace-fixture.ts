import { loadCoordinatorTripContext } from "@commons/database";
import { createSavedFixtureResearchDecisionWorkflow } from "./research-decision-workflow";
import { researchDecisionQueryFromCurrentContext } from "./research-decision-review";
import { decisionSources, sonomaTransportBrief, transportFixtureExtraction } from "../../../../packages/domain/src/research-decision-fixture";

/** Cannot be enabled on a hosted build, production, another database, another
 * actor or another trip. No API credentials, fetch, model or supplier is used. */
export function researchWorkspaceFixtureAllowed(environment: Record<string, string | undefined>) {
  if (environment.NODE_ENV !== "development" || environment.VERCEL || environment.VERCEL_ENV
    || environment.COMMONS_RESEARCH_WORKSPACE_FIXTURE !== "true"
    || environment.COMMONS_PILOT_ACTOR_ID !== "96000000-0000-4000-8000-000000000001") return false;
  try { const u = new URL(environment.DATABASE_URL ?? ""); return u.protocol === "postgresql:" && u.hostname === "127.0.0.1" && u.pathname === "/commons_itinerary_test"; }
  catch { return false; }
}
export const researchWorkspaceFixtureTrip = "96000000-0000-4000-8000-000000000002";
export function researchWorkspaceFixtureWorker(databaseUrl: string) {
  const excerpt = `${decisionSources()[0].excerpt} Estate tasting. Maximum 12 guests.`;
  return createSavedFixtureResearchDecisionWorkflow({ providerName: "local-scripted-fixture",
    provider: { search: async () => [{ url: "https://example.com/synthetic-research", title: "Synthetic tasting and transport policies", excerpt }],
      read: async urls => urls.map(url => ({ url, excerpt })) },
    extractor: { name: "local-scripted-fixture", extract: async ({ kind, legs, partySize, nominated, sources }) => kind === "transport" && sources[0]
      ? transportFixtureExtraction({ ...sonomaTransportBrief(), legs, partySize }, sources[0]) : ({
      findings: !sources[0] ? [] : nominated.map(n => ({ candidateId: n.id, field: "maximumParty" as const, value: 12,
        source: { runId: sources[0].runId, sourceId: sources[0].sourceId }, quote: "Maximum 12 guests.",
        experience: { id: "estate", name: "Estate tasting", kind: "regular_in_person" as const, quote: "Estate tasting." } })), components: [], packages: [],
    }) },
    publicQuery: async (query, stage) => {
      if (stage.lease.commonsId !== researchWorkspaceFixtureTrip) return null;
      const context = await loadCoordinatorTripContext(stage.lease.commonsId, { databaseUrl, actorPersonId: stage.lease.actorPersonId, includeOwnTravel: false, sharedCoordinator: true });
      return researchDecisionQueryFromCurrentContext(query, stage.execution.input, context, { tripId: stage.lease.commonsId, actorId: stage.lease.actorPersonId,
        taskId: stage.lease.taskId, threadId: stage.lease.threadId, artifactId: stage.execution.artifact.id, pins: stage.execution.pins });
    },
  });
}
