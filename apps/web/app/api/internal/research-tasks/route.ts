import { NextResponse } from "next/server";
import { runResearchTask } from "@commons/database";
import { authorizeCommonsCronRequest, coordinatorResearchEnabled, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { researchForCoordinator } from "@/lib/server/coordinator-research";
import { tavilyResearchProvider } from "@/lib/server/coordinator-research-tavily";
export const maxDuration = 60;
export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const environment = readCommonsRuntimeEnvironment();
  if (environment.COMMONS_DURABLE_RESEARCH_ENABLED !== "true" || !coordinatorResearchEnabled(environment)) return NextResponse.json({ enabled: false });
  if (!environment.TAVILY_API_KEY || !environment.DATABASE_URL) return NextResponse.json({ error: "Research is not configured." }, { status: 503 });
  const provider = tavilyResearchProvider(environment.TAVILY_API_KEY);
  // Fixed fields only: ids, revision, outcome (committed, superseded, cancelled, lease_lost, provider_failed ...) and time. Never a query, brief or result.
  const result = await runResearchTask((query, signal) => researchForCoordinator(query, provider, signal), { databaseUrl: environment.DATABASE_URL,
    onFinished: event => console.info("commons.coordinator.task_worker", event) });
  return NextResponse.json({ processed: result.processed, ...("outcome" in result ? { outcome: result.outcome } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
