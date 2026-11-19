import "server-only";
import { getCommonsAuthIdentity } from "@/lib/supabase/server";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";

function operatorEmails() {
  return new Set((readCommonsRuntimeEnvironment().COMMONS_OPERATOR_EMAIL_ALLOWLIST ?? "")
    .split(",").map((email) => email.trim().toLowerCase()).filter(Boolean));
}

export function isCommonsOperatorEmail(email?: string | null) {
  return Boolean(email && operatorEmails().has(email.trim().toLowerCase()));
}

/**
 * True when the signed-in person is a Commons operator. Their AI use isn't held to any hourly or allowance limit and doesn't use up a trip's shared
 * allowance, so testing in production never interrupts them or a trip's organizers. Authorization is unchanged: they still need an organizer membership,
 * and per-run bounds (tokens, calls and deadlines for one piece of work) still apply.
 */
export async function isCommonsOperatorRequest() {
  const identity = await getCommonsAuthIdentity();
  return isCommonsOperatorEmail(identity?.email);
}
