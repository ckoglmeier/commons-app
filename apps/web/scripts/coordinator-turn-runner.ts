/*
 * Local runner for durably accepted Coordinator turns (conversation durability A2). Run from apps/web:
 *
 *   DATABASE_URL=postgresql://postgres@127.0.0.1:55520/commons_dur_app node --import tsx scripts/coordinator-turn-runner.ts [--fixture] [--once]
 *
 * It refuses any database that is not on 127.0.0.1. `--fixture` installs the deterministic provider transport (all other outbound requests are
 * refused); without it the runner would use whatever provider keys its environment has, so never start it without `--fixture` in this assignment.
 * SIGINT/SIGTERM stop claiming and let in-flight turns finish (each is bounded by its deadlines).
 */
import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

registerHooks({ resolve(specifier, context, next) {
  if (specifier === "server-only") return { url: pathToFileURL(join(__dirname, "../lib/test-support/empty-module.cjs")).href, format: "commonjs", shortCircuit: true };
  return next(specifier, context);
} });

const args = new Set(process.argv.slice(2));
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || new URL(databaseUrl).hostname !== "127.0.0.1") { console.error("coordinator-turn-runner: a local DATABASE_URL on 127.0.0.1 is required."); process.exit(2); }
if (!args.has("--fixture")) { console.error("coordinator-turn-runner: --fixture is required; this local runner does not call paid providers."); process.exit(2); }

async function main(url: string) {
  if (args.has("--fixture")) (await import("../lib/test-support/turn-runner-fixture")).installTurnRunnerFixture();
  process.env.COMMONS_EMAIL_SEND_MODE = "disabled";

  const { runCoordinatorTurnLoop, runOneCoordinatorTurn, defaultRunnerId } = await import("../lib/server/coordinator-turn-runner");
  const { COORDINATOR_TURN_NOTIFY_CHANNEL } = await import("@commons/database");
  const postgres = (await import("postgres")).default;
  const workerId = process.env.COMMONS_TURN_RUNNER_ID ?? defaultRunnerId();
  // Fixture-only crash point for the two-process recovery tests: exit right after a claim commits, before any provider work.
  const crashAt = process.env.COMMONS_TURN_RUNNER_TEST_CRASH_AT;
  const observe = (event: { kind?: string; [field: string]: unknown }) => { console.log(JSON.stringify({ event: "commons.coordinator.turn_runner", ...event })); if (crashAt && event.kind === crashAt) process.exit(137); };
  const options = {
    databaseUrl: url, workerId, observe, processingStopped: process.env.COMMONS_DURABLE_COORDINATOR_TURNS_PROCESSING_STOPPED === "true",
    ...(process.env.COMMONS_TURN_RUNNER_LEASE_MS ? { leaseMs: Number(process.env.COMMONS_TURN_RUNNER_LEASE_MS) } : {}),
    ...(process.env.COMMONS_TURN_RUNNER_MAX_QUEUE_MS ? { maxQueueMs: Number(process.env.COMMONS_TURN_RUNNER_MAX_QUEUE_MS) } : {}),
    // Fixture-only: never renew, so the lease is lost while this process still runs (stale-writer test).
    ...(process.env.COMMONS_TURN_RUNNER_TEST_NO_RENEW === "1" ? { renewMs: 3_600_000 } : {}),
  };
  if (args.has("--drain")) {
    for (;;) { const result = await runOneCoordinatorTurn(options); observe({ kind: "drained", result }); if (result.kind === "idle") return; }
  }
  if (args.has("--once")) { observe({ kind: "once", result: await runOneCoordinatorTurn(options) }); return; }

  const controller = new AbortController();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => controller.abort());
  const listener = postgres(url, { max: 1 });
  const listeners = new Set<() => void>();
  await listener.listen(COORDINATOR_TURN_NOTIFY_CHANNEL, () => { for (const wake of listeners) wake(); });
  observe({ kind: "started", workerId, pid: process.pid });
  await runCoordinatorTurnLoop({ ...options, concurrency: Number(process.env.COMMONS_TURN_RUNNER_CONCURRENCY ?? 2), pollMs: Number(process.env.COMMONS_TURN_RUNNER_POLL_MS ?? 1000), signal: controller.signal,
    wake: listener_ => { listeners.add(listener_); return () => listeners.delete(listener_); } });
  await listener.end({ timeout: 1 });
  observe({ kind: "stopped", workerId });
}

main(databaseUrl).then(() => process.exit(0), error => { console.error("coordinator-turn-runner failed", error instanceof Error ? `${error.name}: ${error.message.slice(0, 200)}` : "error"); process.exit(1); });
