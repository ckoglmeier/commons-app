/** Closed beta is the release default, independent of marketing visibility or payment configuration. */
export function closedBetaRequired(environment: { [key: string]: unknown } = process.env) {
  return environment.COMMONS_CLOSED_BETA_REQUIRED !== "false";
}

type CreationEnvironment = {
  COMMONS_EVENT_ONBOARDING_ENABLED?: string;
  COMMONS_EVENT_ONBOARDING_ALLOWLIST?: string;
  COMMONS_EMAIL_RECIPIENT_ALLOWLIST?: string;
  VERCEL_ENV?: string;
};

export function hasBootstrapEventCreationAccess(environment: CreationEnvironment, nodeEnv: string | undefined, email?: string) {
  if (environment.COMMONS_EVENT_ONBOARDING_ENABLED === "true") return true;
  const allowlist = new Set((environment.COMMONS_EVENT_ONBOARDING_ALLOWLIST ?? environment.COMMONS_EMAIL_RECIPIENT_ALLOWLIST ?? "")
    .split(",").map(value => value.trim().toLowerCase()).filter(Boolean));
  if (!environment.VERCEL_ENV && nodeEnv === "development" && allowlist.size === 0) return true;
  return Boolean(email && allowlist.has(email.trim().toLowerCase()));
}

/**
 * Account-level creation decision once the bootstrap policy has not already allowed it.
 * With the public free beta on, any signed-in account with a claimed email may create a trip without operator approval;
 * an operator's explicit "revoked" row still blocks. With it off, only an approved row allows (today's behavior).
 * Free-beta creation never writes an event_creation_access row, so it is not pilot access.
 */
export function eventCreationDecision(input: { publicFreeBeta: boolean; requestOnly?: boolean; accessStatus: string | null; hasClaimedEmail: boolean }) {
  if (input.accessStatus === "revoked") return { allowed: false, status: "revoked" as const };
  if (input.accessStatus === "approved") return { allowed: true, status: "approved" as const };
  if (!input.requestOnly && input.publicFreeBeta && input.hasClaimedEmail) return { allowed: true, status: "approved" as const };
  return { allowed: false, status: input.accessStatus };
}
