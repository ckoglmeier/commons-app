import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { CommonsApp } from "@/components/commons-app";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";
import { betaReworkEnabled } from "@/lib/beta/flags";
import { parseDecisionAction, decisionHandoffPath, resolveDecisionHandoff, type DecisionHandoff } from "@/lib/decision-handoff";
import { loadAuthenticatedPoll } from "@/lib/server/polls";
import { inAppThreadEnabledFor, readCommonsRuntimeEnvironment, textMessagingAvailable, webMessagesEnabledFor } from "@/lib/server/runtime-environment";
import { betaFeatureEnabled, tripMapAvailable } from "@/lib/beta/flags";
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
  searchParams: Promise<{ arrival?: string; travelExpense?: string; view?: string; section?: string; item?: string; itemId?: string; decisionPoll?: string; decisionAction?: string }>;
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
  const newExperience = betaReworkEnabled() && snapshot.commons.newExperience === true;
  return (
    <CommonsApp
      betaActivationEnabled={betaActivationEnabled()}
      tripStagesOn={newExperience}
      key={`${snapshot.commons.id}:${snapshot.currentActor.id}:${snapshot.currentActor.role}:${decisionHandoff?.pollId ?? ""}:${decisionHandoff?.action ?? ""}`}
      initialSnapshot={snapshot}
      dataMode={getCommonsDataMode(identifier)}
      signedIn={Boolean(identity)}
      initialPlanSection={parsePlanSection(entry.section, tripMapAvailable(environment, newExperience))}
      tripMapEnabled={tripMapAvailable(environment, newExperience)}
      betaCompletion={newExperience ? { paymentReports: betaFeatureEnabled("payment_reports", environment), closure: betaFeatureEnabled("closure", environment), recap: betaFeatureEnabled("recap", environment), successor: betaFeatureEnabled("successor", environment) } : undefined}
      tripLetterEnabled={newExperience}
      textMessagingEnabled={webMessagesEnabledFor(identity?.email, environment) ? "web" : textMessagingAvailable(environment) || inAppThreadEnabledFor(identity?.email, environment) ? "sms" : false}
      betaMapEnabled={newExperience && betaFeatureEnabled("map", environment)}
      initialItem={entry.itemId && (entry.item === "plan" || entry.item === "stay") ? {kind: entry.item, id: entry.itemId} : undefined}
      initialView={decisionHandoff ? decisionHandoff.action === "plan" ? "plan" : "logistics" : initialView}
      decisionHandoff={decisionHandoff}
      decisionHandoffUnavailable={Boolean(entry.decisionPoll && !decisionHandoff)}
      showArrival={!entry.decisionPoll && !entry.view && entry.arrival !== "0" && !entry.travelExpense}
      confirmationIntakeEnabled={environment.COMMONS_CONFIRMATION_INTAKE_ENABLED === "true"}
      openTravelExpense={entry.travelExpense}
    />
  );
}
