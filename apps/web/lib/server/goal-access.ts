import "server-only";
import { coordinatorGoalsEnabled } from "./runtime-environment";
import { recipesAvailableFor } from "./recipe-access";
import { resolveTripCapabilities } from "./trip-capabilities";

/** Same verified account AND resolved trip pilot as Ask. A global recipe flag
 * cannot expand this pilot; organizer authorization still follows at each read/write. */
export async function coordinatorGoalsAvailableFor(slug: string, environment: { [name: string]: unknown } = process.env) {
  try { if (!(await resolveTripCapabilities(slug, environment)).goals) return false; } catch { return false; }
  if (coordinatorGoalsEnabled(environment)) return true;
  return environment.COMMONS_COORDINATOR_GOALS_PILOT_ENABLED === "true"
    && await recipesAvailableFor(slug, { ...environment, COMMONS_RECIPES_ENABLED: "false" });
}
