/*
 * Test-only "web process" for the two-process durability tests: authenticates as COMMONS_PILOT_ACTOR_ID through the local-development actor path,
 * posts one JSON turn to the real turns route (durable admission when enabled), prints the response and exits at once. The process is gone before
 * any runner claims the work. Requires TEST_DATABASE_URL on 127.0.0.1.
 */
import { actAs, loadCoordinatorRoutes } from "../server/coordinator-route-harness";

async function main() {
  const [slug, personId, commandJson] = process.argv.slice(2);
  actAs(personId);
  process.env.COMMONS_DURABLE_COORDINATOR_TURNS_ENABLED = "true";
  process.env.OPENROUTER_API_KEY = "fixture-transport-not-a-key"; process.env.OPENAI_API_KEY = "fixture-transport-not-a-key";
  globalThis.fetch = (async () => { throw new TypeError("The admitting process makes no outbound requests."); }) as typeof fetch;
  const routes = await loadCoordinatorRoutes();
  const response = await routes.turns.POST(new Request(`http://localhost/api/v1/commons/${slug}/coordinator/turns`, { method: "POST", headers: { "content-type": "application/json" }, body: commandJson }), { params: Promise.resolve({ slug }) });
  console.log(JSON.stringify({ status: response.status, body: await response.json(), pid: process.pid }));
}
main().then(() => process.exit(0), error => { console.error(error); process.exit(1); });
