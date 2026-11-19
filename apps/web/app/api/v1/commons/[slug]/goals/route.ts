/** Canonical Goal endpoint. Legacy coordinator/goals callers share these exact
 * authenticated handlers, feature gates, bounded inputs and revision checks.
 * A route rename does not reinterpret poll-workflow run IDs as Goal IDs.
 */
export { GET, POST, PATCH } from "../coordinator/goals/route";
