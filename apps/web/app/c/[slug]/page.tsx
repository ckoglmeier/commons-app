import { authenticatedPersonalHistory } from "@/lib/server/personal-coordinator";
import { tripCoordinator } from "@/lib/server/trip-coordinator";
import { tripCapabilitiesFor } from "@/lib/server/trip-capabilities";
import { authenticatedGoals } from "@/lib/server/coordinator-goal-service";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CommonsApp } from "@/components/commons-app";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { parseDecisionAction, decisionHandoffPath, resolveDecisionHandoff, type DecisionHandoff } from "@/lib/decision-handoff";
import { loadAuthenticatedPoll } from "@/lib/server/polls";
import { groupMessagesEnabled, inAppThreadEnabledFor, readCommonsRuntimeEnvironment, textMessagingAvailable, webMessagesEnabledFor } from "@/lib/server/runtime-environment";
import { betaFeatureEnabled, tripMapAvailable } from "@/lib/beta/flags";
import { coordinatorConversationConfigured } from "@/lib/server/coordinator-inference-policy";
import { commonsPath, eventLocation, parsePlanSection, PUBLIC_DEMO_COMMONS_ID } from "@/lib/commons-route";
import {
  getCommonsDataMode,
  getCurrentCommonsIdentity,
  isPublicDemoCommonsIdentifier,
  loadCommonsSnapshot,
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "@/lib/server/commons";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: identifier } = await params;
  if (isPublicDemoCommonsIdentifier(identifier)) {
    return { title: "[DEMO] Cape Cod Couples Week — Commons" };
  }
  return { title: "Commons — Group travel with less group work." };
}

export default async function CommonsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ arrival?: string; conversation?: string; travelExpense?: string; view?: string; section?: string; item?: string; itemId?: string; decisionPoll?: string; decisionAction?: string; thread?: string; draft?: string; poll?: string; itinerary?: string; research?: string; ask?: string; new?: string; voice?: string }>;
}) {
  const { slug: identifier } = await params;
  const entry = await searchParams;
  const initialView = eventLocation(new URLSearchParams(Object.entries(entry).filter((pair): pair is [string, string] => typeof pair[1] === "string")));

  const action = parseDecisionAction(entry.decisionAction);
  const pollId = entry.decisionPoll && /^[0-9a-f-]{36}$/i.test(entry.decisionPoll) ? entry.decisionPoll : null;
  const entryPath = (id: string) => {
    if (action && pollId) return decisionHandoffPath(id, pollId, action);
    const search = new URLSearchParams(Object.entries(entry).filter((pair): pair is [string, string] => typeof pair[1] === "string"));
    return `${commonsPath(id)}${search.size ? `?${search}` : ""}`;
  };
  if (identifier === "austin-weekend") redirect(entryPath(PUBLIC_DEMO_COMMONS_ID));
  let snapshot: Awaited<ReturnType<typeof loadCommonsSnapshot>>;
  try {
    snapshot = await loadCommonsSnapshot(identifier);
  } catch (error) {
    if (error instanceof CommonsAuthenticationRequiredError) {
      redirect(`/sign-in?next=${encodeURIComponent(entryPath(identifier))}`);
    }
    if (error instanceof CommonsMembershipRequiredError) notFound();
    throw error;
  }
  if (!snapshot) notFound();
  if (identifier !== snapshot.commons.id) redirect(entryPath(snapshot.commons.id));
  const identity = await getCurrentCommonsIdentity();
  let decisionHandoff: DecisionHandoff | null = null;
  if (action && pollId && !isPublicDemoCommonsIdentifier(identifier)) {
    try {
      const poll = await loadAuthenticatedPoll(snapshot.commons.id, pollId);
      if (poll) decisionHandoff = resolveDecisionHandoff(poll, action, snapshot.state.itinerary);
    } catch { /* Fail closed; no editor or poll data is exposed by a forged link. */ }
  }
  const environment = readCommonsRuntimeEnvironment();
  const messagesEnabled = !isPublicDemoCommonsIdentifier(identifier) && groupMessagesEnabled();
  // Free beta capability boundary (trip-capabilities.ts): a free trip mounts no Coordinator workspace, creates no main
  // thread and loads no personal history. Links to held-back work resolve to Trip; a published-poll link opens that poll.
  const newExperience = betaReworkEnabled() && snapshot.commons.newExperience === true;
  const capabilities = await tripCapabilitiesFor(snapshot.commons.id);
  const heldEntry = !capabilities.coordinator && (initialView === "coordinator" || Boolean(entry.thread || entry.draft || entry.itinerary || entry.research || entry.ask || entry.new || entry.voice));
  if (heldEntry && entry.poll && /^[0-9a-f-]{36}$/i.test(entry.poll) && !isPublicDemoCommonsIdentifier(identifier)) redirect(`${commonsPath(snapshot.commons.id)}/polls/${entry.poll}`);
  const organizerWorkspace = capabilities.coordinator && snapshot.currentActor.role === "organizer" && !isPublicDemoCommonsIdentifier(identifier) ? await tripCoordinator(snapshot, entry) : undefined;
  const main = organizerWorkspace?.mainThread?.activeThreadId ? {threadId:organizerWorkspace.mainThread.activeThreadId,turnVersion:organizerWorkspace.mainThread.version,label:"Coordinator"} : undefined;
  // Beta trip: no Coordinator workspace, but the organizer's saved goals feed Needs you and open on their direct pages.
  const directGoals = capabilities.tier === "beta" && snapshot.currentActor.role === "organizer" && !isPublicDemoCommonsIdentifier(identifier)
    ? { goals: (await authenticatedGoals(snapshot.commons.id).catch(() => ({ goals: [] }))).goals } : undefined;
  return (
    <CommonsApp
      betaActivationEnabled={betaActivationEnabled()}
      tripStagesOn={newExperience}
      key={`${snapshot.commons.id}:${snapshot.currentActor.id}:${snapshot.currentActor.role}:${decisionHandoff?.pollId ?? ""}:${decisionHandoff?.action ?? ""}`}
      initialSnapshot={snapshot}
      organizerWorkspace={organizerWorkspace}
      personalTurns={capabilities.coordinator && snapshot.currentActor.role !== "organizer" && !isPublicDemoCommonsIdentifier(identifier) ? await authenticatedPersonalHistory(snapshot.commons.id) : undefined}
      coordinatorAvailable={capabilities.coordinator}
      heldFeatureNotice={heldEntry}
      directGoals={directGoals}
      dataMode={getCommonsDataMode(identifier)}
      signedIn={Boolean(identity)}
      initialPlanSection={parsePlanSection(entry.section, tripMapAvailable(environment, newExperience))}
      tripMapEnabled={tripMapAvailable(environment, newExperience)}
      betaCompletion={newExperience ? { paymentReports: betaFeatureEnabled("payment_reports", environment), closure: betaFeatureEnabled("closure", environment), recap: betaFeatureEnabled("recap", environment), successor: betaFeatureEnabled("successor", environment) } : undefined}
      tripLetterEnabled={newExperience}
      textMessagingEnabled={webMessagesEnabledFor(identity?.email, environment) ? "web" : textMessagingAvailable(environment) || inAppThreadEnabledFor(identity?.email, environment) ? "sms" : false}
      betaMapEnabled={newExperience && betaFeatureEnabled("map", environment)}
      initialItem={entry.itemId && (entry.item === "plan" || entry.item === "stay") ? {kind: entry.item, id: entry.itemId} : undefined}
      initialView={decisionHandoff ? decisionHandoff.action === "plan" ? "plan" : "logistics" : heldEntry ? "home" : initialView}
      decisionHandoff={decisionHandoff}
      decisionHandoffUnavailable={Boolean(entry.decisionPoll && !decisionHandoff)}
      showArrival={!entry.decisionPoll && !entry.view && entry.arrival !== "0" && !(entry.conversation === "1" && messagesEnabled) && !entry.travelExpense}
      // A conversation link opens Home while group messages are paused.
      openConversation={entry.conversation === "1" && messagesEnabled}
      groupMessagesEnabled={messagesEnabled} confirmationIntakeEnabled={environment.COMMONS_CONFIRMATION_INTAKE_ENABLED === "true"}
      coordinator={capabilities.coordinator ? {
        conversationAvailable: coordinatorConversationConfigured(environment),
        // Same rule as the Workspace's Talk control: the Live flag, the OpenAI key for audio, and a configured text policy for the work.
        voiceAvailable: environment.COMMONS_COORDINATOR_LIVE_ENABLED === "true" && Boolean(environment.OPENAI_API_KEY) && coordinatorConversationConfigured(environment),
        ...(main ? { main } : {}),
      } : undefined}
      openTravelExpense={entry.travelExpense}
    />
  );
}
