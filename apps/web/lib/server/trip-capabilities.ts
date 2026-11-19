import { closedBetaRequired } from "./event-creation-policy";
import "server-only";
import { cache } from "react";
import { NextResponse } from "next/server";
import { personHasPilotAccess, tripCreatedUnderBeta, tripPilotAccess } from "@commons/database";
import { betaReworkEnabled, commonsDatabaseUrl } from "./runtime-environment";
import { isPublicDemoCommonsIdentifier } from "./commons";

/*
 * Free beta capability boundary (docs/plans/2026-10-26-free-beta-builder-handoff.md, DESIGN.md "Free beta presentation").
 *
 * COMMONS_PUBLIC_FREE_BETA_ENABLED controls public creation only; switching it off never grants pilot capabilities.
 * With either flag value:
 *   - a trip is "pilot" when at least one active organizer has explicit pilot access (an operator-approved or claimed
 *     operator-invited event-creation grant, or a claimed email in COMMONS_PILOT_ORGANIZER_EMAILS /
 *     COMMONS_EVENT_ONBOARDING_ALLOWLIST), or when the trip is explicitly listed in COMMONS_PILOT_TRIP_IDS; every other
 *     trip is "free". COMMONS_RECIPES_PILOT_TRIP_IDS stays a recipes-only allowance and never grants Coordinator;
 *   - free trips get Trip · Plan · Money and poll framing help only: no general/personal Coordinator, voice, setup chat,
 *     research, goals, recipes or background execution.
 * The public sample trip always presents as free, flag on or off, so it demonstrates the delivered product (it is
 * device-local and never had a working Coordinator).
 *
 * Beta rework (docs/BETA-REWORK.md BR-03, DESIGN.md "Coordination without a Coordinator"): behind the single default-off flag
 * COMMONS_BETA_REWORK_ENABLED, a trip that is not a pilot and carries commons.activation_draft_id (created under first-invite activation)
 * resolves to "beta": Trip · Plan · Money, no general or personal Coordinator, voice, personalities, setup chat or broad
 * research (coordinator: false), while goals, guided recipes, polls, participant questions and decision evidence work
 * through direct pages and their own endpoints (goals: true). Pilot trips keep what they have; with the flag off the
 * resolver is identical to the two-tier policy above.
 *
 * COMMONS_RESEARCH_BETA_ENABLED ("all app users") and COMMONS_EVENT_ONBOARDING_ENABLED (open creation) never grant pilot
 * access. Hiding a capability never deletes saved conversations, drafts, tasks or history.
 */

export type TripCapabilityTier = "pilot" | "free" | "beta";
export type TripCapabilities = {
  tier: TripCapabilityTier;
  /** General organizer workspace, personal Coordinator, voice, research, goals, recipes, tasks runner. */
  coordinator: boolean;
  /** Goals, guided recipes (Ask the group), participant questions: direct pages and endpoints that need no conversation. */
  goals: boolean;
  /** Bounded poll framing help in the standalone editor. Available on both tiers; metered separately on free trips. */
  pollAssistance: boolean;
};

type Environment = { [name: string]: unknown };

const PILOT: TripCapabilities = { tier: "pilot", coordinator: true, goals: true, pollAssistance: true };
const FREE: TripCapabilities = { tier: "free", coordinator: false, goals: false, pollAssistance: true };
const BETA: TripCapabilities = { tier: "beta", coordinator: false, goals: true, pollAssistance: true };

/**
 * Coordinator is retired (CK, November 2026; DESIGN.md "Coordinator is retired"). Pilot trips resolve to direct goals and polls, like
 * every other trip with goals. Saved conversations stay in the database. COMMONS_COORDINATOR_ENABLED=true restores it until the code is removed.
 */
export function coordinatorRetired(environment: Environment = process.env) {
  return environment.COMMONS_COORDINATOR_ENABLED !== "true";
}

export function publicFreeBetaEnabled(environment: Environment = process.env) {
  return !closedBetaRequired(environment) && environment.COMMONS_MARKETING_ROUTES_ENABLED !== "true" && environment.COMMONS_PUBLIC_FREE_BETA_ENABLED === "true";
}

export function pilotOrganizerEmails(environment: Environment = process.env) {
  return [environment.COMMONS_PILOT_ORGANIZER_EMAILS, environment.COMMONS_EVENT_ONBOARDING_ALLOWLIST]
    .flatMap(value => typeof value === "string" ? value.split(",") : [])
    .map(value => value.trim().toLowerCase()).filter(Boolean);
}

/** Trips an operator lists as full pilots (COMMONS_PILOT_TRIP_IDS): never downgraded by turning the public flag on. */
export function pilotTripIds(environment: Environment = process.env) {
  return new Set([environment.COMMONS_PILOT_TRIP_IDS]
    .flatMap(value => typeof value === "string" ? value.split(",") : []).map(value => value.trim().toLowerCase()).filter(Boolean));
}

/** Capabilities of a trip, resolved on the server. Unknown trips resolve as free so nothing extra is exposed. */
export async function resolveTripCapabilities(identifier: string, environment: Environment = process.env, databaseUrl = commonsDatabaseUrl()): Promise<TripCapabilities> {
  if (isPublicDemoCommonsIdentifier(identifier)) return FREE;
  if (!databaseUrl) return FREE;
  const access = await tripPilotAccess(identifier, pilotOrganizerEmails(environment), databaseUrl);
  if (!access) return FREE;
  if (access.pilot || pilotTripIds(environment).has(access.tripId.toLowerCase())) return coordinatorRetired(environment) ? BETA : PILOT;
  // Fail closed to free: an unreadable draft never widens a trip's capabilities.
  if (betaReworkEnabled(environment) && await tripCreatedUnderBeta(access.tripId, databaseUrl).catch(() => false)) return BETA;
  return FREE;
}

/** Per-request memoized form for pages and routes. */
export const tripCapabilitiesFor = cache((identifier: string) => resolveTripCapabilities(identifier));

/** Account-level pilot check for flows without a trip yet (setup chat during creation). */
export async function accountHasPilotCapabilities(personId: string, environment: Environment = process.env, databaseUrl = commonsDatabaseUrl()) {
  if (!databaseUrl) return false;
  return personHasPilotAccess(personId, pilotOrganizerEmails(environment), databaseUrl);
}

/**
 * Recovery destination for a link to a held-back page on a free trip: Trip, which shows one quiet notice. The trip page
 * still performs its own sign-in and membership checks, so this reveals nothing to someone without access.
 */
export function heldFeaturePath(identifier: string) {
  return `/c/${encodeURIComponent(identifier)}?arrival=0&view=coordinator`;
}

export const CAPABILITY_UNAVAILABLE_MESSAGE = "Coordinator has been retired. Your trip is unchanged.";

/** A stable 403 for held-back agent capabilities. Carries no trip data. */
export function capabilityUnavailableResponse() {
  return NextResponse.json({ error: CAPABILITY_UNAVAILABLE_MESSAGE, code: "capability_unavailable" }, { status: 403, headers: { "Cache-Control": "no-store" } });
}

/**
 * Route guard for held-back agent endpoints: returns the 403 response when the trip lacks `capability` (default: the general
 * Coordinator; "goals" for the direct goal, recipe and participant-question endpoints), null otherwise. Call it before
 * reading the body, reserving inference or touching providers. Authorization still runs inside the handler.
 */
export async function agentCapabilityBlock(identifier: string, capability: "coordinator" | "goals" = "coordinator") {
  const capabilities = await resolveTripCapabilities(identifier);
  return capabilities[capability] ? null : capabilityUnavailableResponse();
}
