import { NextResponse } from "next/server";
import { coordinatorTurnQueueState } from "@commons/database";
import { runOneCoordinatorTurn } from "@/lib/server/coordinator-turn-runner";
import { authorizeCommonsCronRequest, durableCoordinatorProcessingStopped, readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export const maxDuration = 60;

/**
 * Prepared, NOT scheduled (conversation durability A2): one bounded invocation of the durable Coordinator turn runner, for hosted review. It is inert
 * unless COMMONS_COORDINATOR_TURN_RUNNER=active, and apps/web/vercel.json has no cron for it. Activation needs the separately approved trigger, a
 * cadence shorter than the 60-second queue limit, the health check and rollback in CONVERSATION-DURABILITY-REPORT.md. A cron credential authorizes
 * processing only; each turn re-checks its owner's authority. Claims stop 15 seconds before this function's limit so a claimed turn can still finish
 * (ordinary turns are bounded at 105 seconds, so a long one is renewed only while this invocation lives and is otherwise interrupted, not replayed).
 */
export async function GET(request: Request) {
  const authorization = authorizeCommonsCronRequest(request);
  if (!authorization.authorized) return NextResponse.json({ error: authorization.error }, { status: authorization.status });
  const environment = readCommonsRuntimeEnvironment();
  if (process.env.COMMONS_COORDINATOR_TURN_RUNNER?.trim() !== "active" || !environment.DATABASE_URL) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "no-store" } });
  const started = Date.now(), outcomes: string[] = [];
  while (Date.now() - started < 45_000 && outcomes.length < 10) {
    const result = await runOneCoordinatorTurn({ databaseUrl: environment.DATABASE_URL, processingStopped: durableCoordinatorProcessingStopped(),
      ...(isSupabaseAuthConfigured() ? { resolveVerifiedEmail: getSupabaseVerifiedAuthUserEmail } : {}),
      observe: event => console.info("commons.coordinator.turn_runner", event) });
    if (result.kind === "idle") break;
    outcomes.push(result.kind === "ran" ? result.status : result.disposition);
  }
  return NextResponse.json({ enabled: true, processed: outcomes.length, outcomes, queue: await coordinatorTurnQueueState({ databaseUrl: environment.DATABASE_URL }) }, { headers: { "Cache-Control": "no-store" } });
}
