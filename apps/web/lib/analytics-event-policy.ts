import { redactInvitationPath } from "./analytics-invitation-privacy";
import { sanitizeCampaignValue } from "./analytics-attribution";

// Recorded only by lib/server/outcome-telemetry.ts and instrumentation.ts after a committed command or a server error.
const SERVER_ONLY_EVENTS = new Set(["account_setup_completed", "invitation_accepted", "group_joined", "poll_response_saved", "poll_decision_recorded", "plan_item_saved", "operation_failed", "server_error", "poll_assist_generation"]);

/** A browser cannot write a row that reports or analytics could read as a server outcome or failure. */
export function browserEventAllowed(input: { eventName: string; pagePath: string }) {
  // Check the stored (normalised) path as well as the raw one, e.g. "/./server/outcome".
  return !SERVER_ONLY_EVENTS.has(input.eventName) && ![input.pagePath, redactInvitationPath(input.pagePath)].some(path => /^\/+server(\/|$)/.test(path));
}

const CAMPAIGN_PROPERTIES = new Set(["utmSource", "utmMedium", "utmCampaign", "firstUtmSource", "firstUtmMedium", "firstUtmCampaign"]);
// Server-side outcomes are recorded only by lib/server/outcome-telemetry.ts; a browser cannot claim one.
const RESERVED_PROPERTIES = new Set(["source", "internal", "release"]);

/** Re-applies the campaign allowlist on the server so a crafted request cannot store arbitrary query text. */
export function sanitizedEventProperties(properties: Record<string, string | number | boolean | null>) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (RESERVED_PROPERTIES.has(key)) continue;
    result[key] = CAMPAIGN_PROPERTIES.has(key) ? (typeof value === "string" ? sanitizeCampaignValue(value) ?? null : null) : value;
  }
  return result;
}
