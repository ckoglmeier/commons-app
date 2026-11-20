import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache } from "react";
import { CommonsApp } from "@/components/commons-app";
import { parseDecisionAction, decisionHandoffPath, resolveDecisionHandoff, type DecisionHandoff } from "@/lib/decision-handoff";
import { loadAuthenticatedPoll } from "@/lib/server/polls";
import { readCommonsRuntimeEnvironment, textMessagingAvailable } from "@/lib/server/runtime-environment";
import { currentPersonIsInstanceAdmin } from "@/lib/server/instance-access";
import { emailDeliveryAvailable } from "@/lib/email/resend";
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

// One snapshot load per request, shared by the title and the page.
const loadTrip = cache(loadCommonsSnapshot);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug: identifier } = await params;
  // The trip name appears only to someone who can open the trip; the loader enforces membership.
  const snapshot = await loadTrip(identifier).catch(() => null);
  return { title: snapshot ? `${snapshot.commons.name} — Commons` : "Trip — Commons" };
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
    snapshot = await loadTrip(identifier);
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
  const instanceAdmin = identity ? await currentPersonIsInstanceAdmin() : false;
  const environment = readCommonsRuntimeEnvironment();
  const newExperience = snapshot.commons.newExperience === true;
  return (
    <CommonsApp
      tripStagesOn={newExperience}
      key={`${snapshot.commons.id}:${snapshot.currentActor.id}:${snapshot.currentActor.role}:${decisionHandoff?.pollId ?? ""}:${decisionHandoff?.action ?? ""}`}
      initialSnapshot={snapshot}
      dataMode={getCommonsDataMode(identifier)}
      signedIn={Boolean(identity)}
      initialPlanSection={parsePlanSection(entry.section, true)}
      betaCompletion={newExperience ? { paymentReports: true, closure: true, recap: true, successor: true } : undefined}
      tripLetterEnabled={newExperience}
      textMessagingEnabled={identity ? "web" : textMessagingAvailable() ? "sms" : false}
      betaMapEnabled={newExperience}
      initialItem={entry.itemId && (entry.item === "plan" || entry.item === "stay") ? {kind: entry.item, id: entry.itemId} : undefined}
      initialView={decisionHandoff ? decisionHandoff.action === "plan" ? "plan" : "logistics" : initialView}
      decisionHandoff={decisionHandoff}
      decisionHandoffUnavailable={Boolean(entry.decisionPoll && !decisionHandoff)}
      showArrival={!entry.decisionPoll && !entry.view && entry.arrival !== "0" && !entry.travelExpense}
      confirmationIntakeEnabled={environment.COMMONS_CONFIRMATION_INTAKE_ENABLED === "true"}
      openTravelExpense={entry.travelExpense}
      emailInvitations={emailDeliveryAvailable()}
      instanceAdmin={instanceAdmin}
    />
  );
}
