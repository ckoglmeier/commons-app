import { canUseCoordinatorSearch, canUseCoordinatorBackgroundResearch } from "./coordinator-search-access";
import { tavilyLookupConfigured } from "./coordinator-research-tavily";
import "server-only";
import type { ComponentProps } from "react";
import type { CommonsSnapshot } from "@commons/contracts";
import type { CoordinatorWorkspace } from "@/components/coordinator-workspace";
import { authenticatedCoordinatorPreferences, authenticatedThreadRelations, ensureAuthenticatedMainThread, loadAuthenticatedCoordinatorRecommendations, loadAuthenticatedCoordinatorThread } from "./polls";
import { authenticatedGoals } from "./coordinator-goal-service";
import { coordinatorDynamicUiEnabled, compareStaysEnabled, coordinatorPersonalitiesEnabled, coordinatorResearchEnabled, readCommonsRuntimeEnvironment } from "./runtime-environment";
import { coordinatorGoalsAvailableFor } from "./goal-access";
import { coordinatorConversationConfigured } from "./coordinator-inference-policy";
import { taskCapability } from "./coordinator-task-service";
import { recipesAvailableFor } from "./recipe-access";
import { itineraryPortabilityAvailableFor } from "./itinerary-portability";

export async function tripCoordinator(snapshot: CommonsSnapshot, entry: { thread?: string; draft?: string; poll?: string; itinerary?: string; ask?: string; new?: string; voice?: string }): Promise<ComponentProps<typeof CoordinatorWorkspace>> {
  const slug = snapshot.commons.id, environment = readCommonsRuntimeEnvironment();
  const goalsEnabled = await coordinatorGoalsAvailableFor(slug, environment);
  const searchAllowed = await canUseCoordinatorSearch();
  const backgroundAllowed = await canUseCoordinatorBackgroundResearch();
  const main = await ensureAuthenticatedMainThread(slug);
  // A link to a thread this organizer cannot open here (malformed, unknown, removed or another trip's) opens the main conversation and says so.
  const unavailableNotice = "That conversation isn’t available here. Showing the main conversation.";
  const linkedThread = entry.thread && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(entry.thread) ? entry.thread : undefined;
  let entryNotice: string | undefined = entry.thread && !linkedThread ? unavailableNotice : undefined;
  let selectedId = linkedThread ?? (entry.draft || entry.poll ? undefined : main.id);
  const selectedThread = await loadAuthenticatedCoordinatorThread(slug, undefined, selectedId).catch(error => {
    if (selectedId === main.id || (error as { coordinatorCode?: string }).coordinatorCode !== "thread_unavailable") throw error;
    selectedId = main.id;
    entryNotice = unavailableNotice;
    return loadAuthenticatedCoordinatorThread(slug, undefined, main.id);
  });
  const [loadedThread, mainThread, recommendations, relations, goals, preferences] = await Promise.all([
    selectedThread,
    selectedId === main.id ? Promise.resolve(null) : loadAuthenticatedCoordinatorThread(slug, undefined, main.id),
    loadAuthenticatedCoordinatorRecommendations(slug), authenticatedThreadRelations(slug),
    authenticatedGoals(slug), coordinatorPersonalitiesEnabled(environment) ? authenticatedCoordinatorPreferences(slug) : undefined,
  ]);
  const pollThreadId = entry.poll && loadedThread.polls.find(poll => poll.id === entry.poll && !poll.archivedAt)?.threadId;
  const initialThread = pollThreadId && pollThreadId !== loadedThread.activeThreadId
    ? await loadAuthenticatedCoordinatorThread(slug, undefined, pollThreadId) : loadedThread;
  return {
    ...(entryNotice ? { entryNotice } : {}),
    activityDecisionsEnabled: snapshot.currentActor.role === "organizer" && environment.COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED === "true" && searchAllowed,
    dynamicUiEnabled: snapshot.currentActor.role === "organizer" && coordinatorDynamicUiEnabled(environment),
    compareStaysEnabled: snapshot.currentActor.role === "organizer" && compareStaysEnabled(environment),
    assistantUiEnabled: environment.COMMONS_ASSISTANT_UI_ENABLED === "true", recipesEnabled: await recipesAvailableFor(slug, environment), portabilityEnabled: await itineraryPortabilityAvailableFor(slug, environment),
    slug, eventName: snapshot.commons.name, initialThread, mainThread: mainThread ?? loadedThread, initialRecommendations: recommendations,
    initialItineraryId: initialThread.turns.some(turn => turn.workspace?.itineraryDraft?.id === entry.itinerary) ? entry.itinerary : undefined,
    initialDraftId: initialThread.drafts.some(item => item.id === entry.draft && !item.publishedPollId) ? entry.draft : undefined,
    initialPollId: initialThread.polls.some(item => item.id === entry.poll && !item.archivedAt) ? entry.poll : undefined,
    startQuestion: entry.ask === "1", startNew: entry.new === "1" && !goalsEnabled,
    voiceReady: entry.voice === "1", tripFacts: {startsOn:snapshot.commons.startsOn, endsOn:snapshot.commons.endsOn},
    tripIdeas: snapshot.state.itinerary.filter(item=>item.status === "idea" && !item.startsAt).map(item=>({id:item.id,title:item.title,status:item.status,provenanceLabel:item.provenanceLabel,...(item.sourceUrl ? {sourceUrl:item.sourceUrl} : {})})),
    continuity: {mainThreadId:main.id,capability:taskCapability(backgroundAllowed ? environment : {...environment,COMMONS_DURABLE_RESEARCH_ENABLED:"false"}),relations},
    goalsEnabled, brainEnabled:environment.COMMONS_TRIP_BRAIN_ENABLED === "true", initialGoals:goals,
    coordinatorPreferences:preferences, actorId:snapshot.currentActor.id, actorName:snapshot.currentActor.displayName,
    conversationAvailable:coordinatorConversationConfigured(environment), voiceAvailable:environment.COMMONS_COORDINATOR_LIVE_ENABLED === "true" && Boolean(environment.OPENAI_API_KEY) && coordinatorConversationConfigured(environment),
    researchAvailable:searchAllowed && coordinatorResearchEnabled(environment) && tavilyLookupConfigured(environment), durableResearchAvailable:backgroundAllowed && coordinatorResearchEnabled(environment) && environment.COMMONS_DURABLE_RESEARCH_ENABLED === "true" && Boolean(environment.TAVILY_API_KEY), runnerOperating:environment.COMMONS_COORDINATOR_TASK_RUNNER === "active",
  };
}
