import "server-only";
import { canUseCoordinatorSearch } from "./coordinator-search-access";
import { readCommonsRuntimeEnvironment } from "./runtime-environment";

/** Temporary CK-only pilot; a client flag or local actor never grants access. */
export async function canUseActivityDecisions(environment = readCommonsRuntimeEnvironment()) {
  return environment.COMMONS_ACTIVITY_DECISIONS_PILOT_ENABLED === "true" && await canUseCoordinatorSearch();
}
