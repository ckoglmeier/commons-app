import { appendFileSync, existsSync } from "node:fs";
import { fakeStreamingProviderResponse } from "../server/coordinator-route-harness";

/*
 * Deterministic provider transport for the local turn runner (conversation durability A2 qualification). Never used by production code.
 *
 * Every OpenRouter / OpenAI chat-completion request gets a fixed completion in the real response shape; every other outbound request is refused. Each
 * provider request is appended to COMMONS_TURN_RUNNER_CALL_LOG (pid, time, model, stream flag; never the prompt), so tests count calls across processes.
 * With COMMONS_TURN_RUNNER_GATE_FILE set, a provider request waits until that file exists, so a test can kill the process while the provider "runs".
 */
export function installTurnRunnerFixture(env: NodeJS.ProcessEnv = process.env) {
  const reply = env.COMMONS_TURN_RUNNER_FIXTURE_REPLY ?? "Try the early seating near Synthetic Peak Lodge. Prices and availability are unverified.";
  const log = env.COMMONS_TURN_RUNNER_CALL_LOG, gate = env.COMMONS_TURN_RUNNER_GATE_FILE;
  process.env.OPENROUTER_API_KEY = "fixture-transport-not-a-key"; process.env.OPENAI_API_KEY = "fixture-transport-not-a-key";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    const provider = url.origin === "https://openrouter.ai" || (url.origin === "https://api.openai.com" && url.pathname === "/v1/chat/completions");
    if (!provider) throw new TypeError(`Outbound request blocked by the turn-runner fixture: ${url.origin}`);
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string; stream?: boolean };
    if (log) appendFileSync(log, `${JSON.stringify({ pid: process.pid, at: new Date().toISOString(), model: body.model ?? null, stream: Boolean(body.stream), carriesTravelerAnswers: String(init?.body ?? "").includes("travelerAnswers") })}\n`);
    if (gate) while (!existsSync(gate)) await new Promise(resolve => setTimeout(resolve, 25));
    return fakeStreamingProviderResponse(body, reply, env.COMMONS_TURN_RUNNER_FIXTURE_DELAY_MS ? { delayMs: Number(env.COMMONS_TURN_RUNNER_FIXTURE_DELAY_MS) } : {});
  }) as typeof fetch;
}
