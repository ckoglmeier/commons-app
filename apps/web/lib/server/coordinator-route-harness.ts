import { registerHooks } from "node:module";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
/**
 * Test-only harness: drives the real coordinator route handlers against the
 * disposable local test database, with the local-development actor instead of
 * Supabase auth and a fake model provider. Never import from production code.
 *
 * Requires COMMONS_RUN_DATABASE_TESTS=1 and a TEST_DATABASE_URL on 127.0.0.1.
 */
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { commons, createDatabase, eventCreationAccess, memberships, people, stayParticipants, stays } from "@commons/database";
import { registerComponentImportStubs } from "../test-support/hook-harness";

export const databaseTestsEnabled = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

export function testDatabaseUrl() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || new URL(url).hostname !== "127.0.0.1") throw new Error("Route harness requires a local TEST_DATABASE_URL.");
  return url;
}

/** Act as a person through the local-development pilot actor path (no Supabase). */
export function actAs(personId: string) {
  Object.assign(process.env, {
    NODE_ENV: "development",
    DATABASE_URL: testDatabaseUrl(),
    COMMONS_PILOT_ACTOR_ID: personId,
  });
  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
}

let searchSessionRegistered = false;
function registerSyntheticSearchSession() {
  if (searchSessionRegistered) return;
  const fixture = pathToFileURL(join(__dirname, "../test-support/search-session-fixture.cjs")).href;
  registerHooks({resolve(specifier, context, next) {
    if (specifier === "./coordinator-search-session" && context.parentURL?.includes("coordinator-search-access")) return {url: fixture, format: "commonjs", shortCircuit: true};
    return next(specifier, context);
  }});
  searchSessionRegistered = true;
}

export async function loadCoordinatorRoutes() {
  registerSyntheticSearchSession();
  // `server-only` throws outside the React Server condition; the route code is otherwise plain Node.
  registerComponentImportStubs();
  const [turn, threads, drafts, turns, turnLookup, turnStop, tasks, continuity, sources] = await Promise.all([
    import("../../app/api/v1/commons/[slug]/coordinator/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/threads/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/drafts/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/turns/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/turns/[commandId]/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/turns/[commandId]/stop/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/tasks/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/continuity/route"),
    import("../../app/api/v1/commons/[slug]/coordinator/sources/route"),
  ]);
  return { turn, threads, drafts, turns, turnLookup, turnStop, tasks, continuity, sources };
}

export function jsonRequest(slug: string, path: string, method: string, body?: unknown) {
  return new Request(`http://localhost/api/v1/commons/${slug}/coordinator${path}`, {
    method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

export function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

/** Records `console.warn` structured events such as `commons.coordinator.turn_failed`. */
export function captureWarnings() {
  const original = console.warn;
  const events: Array<{ name: unknown; detail: unknown }> = [];
  console.warn = (name?: unknown, detail?: unknown) => { events.push({ name, detail }); };
  return { events, restore: () => { console.warn = original; } };
}

export type TavilyCall = { path: "search" | "extract"; body: { query?: string; urls?: string[] } };
export type ProviderCall = { url: string; body: { model?: string; messages?: Array<{ role: string; content: string }> } };

export type CoordinatorRoutes = Awaited<ReturnType<typeof loadCoordinatorRoutes>>;
export type RouteRecord = { method: string; path: string; status: number; body: unknown };

/**
 * A fixed completion in the OpenRouter response shape. Only keys declared by
 * the request's strict JSON schema are returned (advisory vs. draft replies).
 */
export function fakeProviderResponse(requestBody: { response_format?: { json_schema?: { schema?: { properties?: Record<string, unknown> } } } }, reply = "Try the early seating near your stay.", topicTitle: string | null = "Saturday dinner", extra: Record<string, unknown> = {}, usage?: {prompt_tokens:number;completion_tokens:number}) {
  const candidate: Record<string, unknown> = { reply, tripSuggestion: null, title: null, intro: null, message: null, edits: [], operations: [], topicTitle,
    threadSummary: "Leaning toward an early dinner near the stay.", openQuestions: ["Which restaurant?"], ...extra };
  const allowed = Object.keys(requestBody.response_format?.json_schema?.schema?.properties ?? { reply: true });
  if (allowed.includes("questions")) {
    const operations = (extra.operations ?? []) as Array<Record<string, unknown>>;
    candidate.questions = extra.questions ?? operations.filter(operation => operation.kind !== "add_message_link").map(operation => operation.kind === "add_text_question"
      ? { kind: "text", prompt: operation.prompt, required: operation.required, selectionMode: null, options: [] }
      : ["add_question", "add_optional_question", "add_workflow_question"].includes(String(operation.kind))
        ? { kind: "choice", prompt: operation.prompt, required: operation.kind !== "add_optional_question", selectionMode: operation.selectionMode, options: (operation.options as Array<Record<string, unknown>>).map(option => ({ exclusive: false, url: null, ...option })) }
        : operation);
    candidate.sourceLinks = extra.sourceLinks ?? operations.filter(operation => operation.kind === "add_message_link").map(operation => operation.link);
  }
  const content = Object.fromEntries(Object.entries(candidate).filter(([key]) => allowed.includes(key)));
  return new Response(JSON.stringify({ ...(usage ? {usage} : {}), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] }), { status: 200, headers: { "content-type": "application/json" } });
}

/**
 * The same completion as `fakeProviderResponse`, streamed the way OpenRouter streams it: `data:` chunks of `chunkChars` characters of the JSON text
 * (split anywhere, including inside escapes), a keep-alive comment, usage on the last chunk, then `[DONE]`. `delayMs` waits before each chunk, `failAfter`
 * ends the stream with a provider error after that many chunks, and `gate` holds the stream after the first chunk until it resolves.
 */
export function fakeStreamingProviderResponse(recorded: object, reply: string, options: { chunkChars?: number; delayMs?: number; failAfter?: number; gate?: Promise<void>; topicTitle?: string | null; extra?: Record<string, unknown> } = {}) {
  const requestBody = recorded as Parameters<typeof fakeProviderResponse>[0] & { stream?: boolean };
  if (!requestBody.stream) return fakeProviderResponse(requestBody, reply, options.topicTitle === undefined ? "Saturday dinner" : options.topicTitle, options.extra);
  const candidate: Record<string, unknown> = { reply, tripSuggestion: null, topicTitle: options.topicTitle === undefined ? "Saturday dinner" : options.topicTitle,
    threadSummary: "Leaning toward an early dinner near the stay.", openQuestions: ["Which restaurant?"], ...options.extra };
  const allowed = Object.keys(requestBody.response_format?.json_schema?.schema?.properties ?? { reply: true });
  const text = JSON.stringify(Object.fromEntries(Object.entries(candidate).filter(([key]) => allowed.includes(key))));
  const size = options.chunkChars ?? 7, pieces: string[] = [];
  for (let index = 0; index < text.length; index += size) pieces.push(text.slice(index, index + size));
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(": OPENROUTER PROCESSING\n\n"));
      for (const [index, piece] of pieces.entries()) {
        if (options.delayMs) await new Promise(resolve => setTimeout(resolve, options.delayMs));
        if (index === 1 && options.gate) await options.gate;
        if (options.failAfter !== undefined && index >= options.failAfter) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: { code: 502, message: "upstream" }, choices: [{ delta: { content: "" }, finish_reason: "error" }] })}\n\n`));
          controller.close(); return;
        }
        // Split each event across two writes so a reader must join partial lines.
        const line = `data: ${JSON.stringify({ choices: [{ delta: { content: piece }, finish_reason: null }] })}\n\n`;
        controller.enqueue(encoder.encode(line.slice(0, 9))); controller.enqueue(encoder.encode(line.slice(9)));
      }
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1200, completion_tokens: 80, cost: 0.00061 } })}\n\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
}

/** Reads a turn event stream to the end (or until `until` returns true) and returns the parsed events. */
export async function readTurnEvents(response: Response, until?: (event: { type: string; [key: string]: unknown }) => boolean) {
  const events: Array<{ type: string; seq: number; [key: string]: unknown }> = [];
  const reader = response.body!.pipeThrough(new TextDecoderStream() as unknown as ReadableWritablePair<string, Uint8Array>).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
      const data = block.split("\n").find(line => line.startsWith("data: "));
      if (!data) continue;
      const event = JSON.parse(data.slice(6));
      events.push(event);
      if (until?.(event)) { await reader.cancel(); return events; }
    }
  }
  return events;
}

/**
 * A fetch implementation that sends coordinator API calls to the real route
 * handlers (in-process) and OpenRouter calls to a recording fake. Any other
 * URL fails the test. Records every coordinator response for assertions.
 */
export type RouteFetchOptions = {
  deepResearch?: (body: Record<string, unknown>) => Response | Promise<Response>;
  reply?: string;
  /** Extra provider fields (summary, open questions, suggestion) merged into the fake completion. */
  extra?: Record<string, unknown>; topicTitle?: string | null;
  /** Fake public search results. Every request to Tavily is recorded in `tavilyCalls`; nothing leaves the process. */
  search?: (query: string) => Array<{ url: string; title: string; content: string }>;
  /** Override the recorded fake provider (for failures, delays, or model-specific replies). */
  provider?: (body: ProviderCall["body"], call: ProviderCall) => Response | Promise<Response>;
};
export function createRouteFetch(routes: CoordinatorRoutes, options: RouteFetchOptions = {}) {
  const records: RouteRecord[] = [];
  const providerCalls: ProviderCall[] = [];
  const tavilyCalls: TavilyCall[] = [];
  const perplexityCalls: Array<{ body: Record<string, unknown> }> = [];
  async function routeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = new URL(String(input instanceof Request ? input.url : input), "http://localhost");
    // Both policies' transports reach the same recording fake: OpenRouter (best) and OpenAI chat completions (openai).
    if (url.origin === "https://openrouter.ai" || (url.origin === "https://api.openai.com" && url.pathname === "/v1/chat/completions")) {
      const body = JSON.parse(String(init?.body ?? "{}"));
      const call = { url: url.href, body };
      providerCalls.push(call);
      return options.provider ? options.provider(body, call) : fakeProviderResponse(body, options.reply, options.topicTitle === undefined ? "Saturday dinner" : options.topicTitle, options.extra);
    }
    if (url.origin === "https://api.perplexity.ai" && url.pathname === "/v1/agent") {
      const body = JSON.parse(String(init?.body ?? "{}")); perplexityCalls.push({ body });
      if (!options.deepResearch) throw new Error("No synthetic deep-research response configured.");
      return options.deepResearch(body);
    }
    if (url.origin === "https://api.tavily.com") {
      const path = url.pathname.slice(1) as TavilyCall["path"], body = JSON.parse(String(init?.body ?? "{}"));
      tavilyCalls.push({ path, body });
      const results = (options.search ?? (() => [{ url: "https://example.com/alpine-table", title: "Alpine Table menu", content: "Family-friendly dinner menu, 4:30 seating." }]))(String(body.query ?? ""));
      return new Response(JSON.stringify(path === "search" ? { results } : { results: (body.urls as string[] ?? []).map(target => ({ url: target, raw_content: `Full page text for ${target}: dinner served 4:30 to 9.` })) }), { status: 200, headers: { "content-type": "application/json" } });
    }
    const match = /^\/api\/v1\/commons\/([^/]+)\/coordinator(\/threads|\/drafts|\/turns|\/tasks|\/continuity|\/sources)?(?:\/([0-9a-f-]{36})(\/stop)?)?\/?$/.exec(url.pathname);
    if (url.origin !== "http://localhost" || !match) throw new Error(`Unexpected network request in test: ${url.href}`);
    const [, slug, sub, commandId, stop] = match;
    const method = (init?.method ?? "GET").toUpperCase();
    const routeModule = sub === "/turns" ? (stop ? routes.turnStop : commandId ? routes.turnLookup : routes.turns) : sub === "/threads" ? routes.threads : sub === "/drafts" ? routes.drafts : sub === "/tasks" ? routes.tasks : sub === "/continuity" ? routes.continuity : sub === "/sources" ? routes.sources : routes.turn;
    const handler = (routeModule as Record<string, unknown>)[method] as ((request: Request, context: { params: Promise<Record<string, string>> }) => Promise<Response>) | undefined;
    if (!handler) throw new Error(`No ${method} handler for ${url.pathname}`);
    const response = await handler(new Request(url.href, { method, headers: init?.headers, body: init?.body, signal: init?.signal }), { params: Promise.resolve({ slug, ...(commandId ? { commandId } : {}) }) });
    // A turn event stream is handed back as it arrives; reading a clone to the end here would hold it back.
    const streamed = response.headers.get("content-type")?.includes("text/event-stream");
    const body = streamed ? null : await response.clone().json().catch(() => null);
    records.push({ method, path: `${sub ?? ""}${commandId ? `/${commandId}${stop ?? ""}` : ""}${url.search}` || "/", status: response.status, body });
    return response;
  }
  return { fetch: routeFetch, records, providerCalls, tavilyCalls, perplexityCalls };
}

/** Replaces global fetch with the route fetch; also enables the fake provider key. */
export function installRouteFetch(routes: CoordinatorRoutes, options: RouteFetchOptions = {}) {
  const original = globalThis.fetch;
  const router = createRouteFetch(routes, options);
  globalThis.fetch = router.fetch as typeof fetch;
  // Keys for both policies' transports; the default policy is openai (direct), and tests can pin best (OpenRouter).
  process.env.OPENROUTER_API_KEY = "test-openrouter-key"; process.env.OPENAI_API_KEY = "test-openai-key";
  return { ...router, restore: () => { globalThis.fetch = original; delete process.env.OPENROUTER_API_KEY; delete process.env.OPENAI_API_KEY; } };
}

export type SyntheticTrip = { eventId: string; organizerId: string; coOrganizerId: string; travelerId: string; stayId: string; cleanup: () => Promise<void> };

/** A synthetic Breckenridge trip: two active organizers, one traveler, saved dates and one saved stay. */
export async function seedSyntheticTrip(options: { pilot?: boolean } = {}): Promise<SyntheticTrip> {
  const url = testDatabaseUrl();
  const db = createDatabase(url);
  const eventId = randomUUID(), organizerId = randomUUID(), coOrganizerId = randomUUID(), travelerId = randomUUID(), stayId = randomUUID();
  const personIds = [organizerId, coOrganizerId, travelerId];
  try {
    await db.db.insert(people).values([
      { id: organizerId, displayName: "Casey Synthetic", authUserId: organizerId },
      { id: coOrganizerId, displayName: "Robin Synthetic", authUserId: coOrganizerId },
      { id: travelerId, displayName: "Taylor Synthetic", authUserId: travelerId },
    ]);
    // Coordinator scenarios represent an explicitly approved pilot, never a rollout-flag bypass.
    if (options.pilot !== false) await db.db.insert(eventCreationAccess).values({ personId: organizerId, requesterEmail: "casey@example.invalid", status: "approved", decidedAt: new Date() });
    await db.db.insert(commons).values({ id: eventId, slug: `qa-${eventId}`, name: "Synthetic Breckenridge weekend", timezone: "America/Denver",
      startsOn: "2027-02-12", endsOn: "2027-02-15", locationName: "Breckenridge, Colorado", createdByPersonId: organizerId });
    await db.db.insert(memberships).values([
      { commonsId: eventId, personId: organizerId, role: "organizer", status: "active" },
      { commonsId: eventId, personId: coOrganizerId, role: "organizer", status: "active" },
      { commonsId: eventId, personId: travelerId, role: "member", status: "active" },
    ]);
    await db.db.insert(stays).values({ id: stayId, commonsId: eventId, createdByPersonId: organizerId, name: "Synthetic Peak Lodge",
      address: "100 Synthetic Ridge Rd, Breckenridge, CO", startsOn: "2027-02-12", endsOn: "2027-02-15", status: "confirmed",
      totalCents: 184_000, costSource: "confirmation", includesTaxesAndFees: true, sourceLabel: "Added by Casey Synthetic" });
    await db.db.insert(stayParticipants).values(personIds.map(personId => ({ stayId, personId })));
  } finally { await db.close(); }
  return {
    eventId, organizerId, coOrganizerId, travelerId, stayId,
    cleanup: async () => {
      const cleanupDb = createDatabase(url);
      try {
        await cleanupDb.db.delete(commons).where(eq(commons.id, eventId));
        await cleanupDb.db.delete(people).where(inArray(people.id, personIds));
      } finally { await cleanupDb.close(); }
    },
  };
}

/** Direct read helper for assertions; bypasses route authorization deliberately. */
export async function withTestDatabase<T>(read: (db: ReturnType<typeof createDatabase>["db"]) => Promise<T>) {
  const database = createDatabase(testDatabaseUrl());
  try { return await read(database.db); } finally { await database.close(); }
}

export { and, eq };

// ---------------------------------------------------------------------------
// Scenario helper shared by the acceptance tests (Stage 4+): a synthetic trip, the real routes, a recording
// fake model, and a recording fake public search. Nothing here reaches a real provider or a remote database.
// ---------------------------------------------------------------------------

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export type ScenarioContext = {
  trip: SyntheticTrip; routes: CoordinatorRoutes; network: ReturnType<typeof installRouteFetch>;
  /** POST /coordinator/turns as `personId` (default: the trip organizer). */
  post: (body: unknown, personId?: string) => Promise<{ status: number; body: Body }>;
  lookup: (commandId: string, personId?: string) => Promise<{ status: number; body: Body }>;
  /** Legacy thread payload (turns, drafts, polls, threads with versions) for one thread. */
  thread: (threadId: string, personId?: string) => Promise<Body>;
  /** A new-thread text command. */
  command: (over?: Record<string, unknown>) => Record<string, unknown>;
  /** The next completion's topic title and summary; mutable between turns. */
  next: { usage?: {prompt_tokens:number;completion_tokens:number}; deepResearch?: RouteFetchOptions["deepResearch"]; title: string | null; summary: string | null; questions: string[]; reply: string; extra: Record<string, unknown>;
    /** Stream the completion in chunks when the request asks for a stream (null: answer with JSON, which the client also accepts). */
    stream: null | { chunkChars?: number; delayMs?: number; gate?: Promise<void>; failAfter?: number } };
  infoLogs: Array<{ name: unknown; detail: unknown }>;
};

export async function withCoordinatorScenario(run: (context: ScenarioContext) => Promise<void>, options: { environment?: Record<string, string> } = {}) {
  const trip = await seedSyntheticTrip();
  const routes = await loadCoordinatorRoutes();
  const next: ScenarioContext["next"] = { title: "Saturday dinner", summary: "Leaning toward an early dinner near the stay.", questions: ["Which restaurant?"], reply: "Try the early seating near your stay.", extra: {}, stream: null };
  const network = installRouteFetch(routes, { deepResearch: body => { if (!next.deepResearch) throw new Error("No synthetic deep-research response configured."); return next.deepResearch(body); }, provider: body => next.stream
    ? fakeStreamingProviderResponse(body, next.reply, { ...next.stream, topicTitle: next.title, extra: { threadSummary: next.summary, openQuestions: next.questions, ...next.extra } })
    : fakeProviderResponse(body as never, next.reply, next.title, { threadSummary: next.summary, openQuestions: next.questions, ...next.extra },next.usage) });
  const warnings = captureWarnings();
  const infoLogs: ScenarioContext["infoLogs"] = [];
  const info = console.info; console.info = (name?: unknown, detail?: unknown) => { infoLogs.push({ name, detail }); };
  const saved: Record<string, string | undefined> = { COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: process.env.COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED };
  for (const [key, value] of Object.entries({ TAVILY_API_KEY: "test-search-key", COMMONS_WORKSPACE_MODEL: "test/base-model", COMMONS_WORKSPACE_MINI_MODEL: "test/mini-model",
    // The default (openai) policy's models; OpenAI receives them without the "openai/" prefix: test-base-model, test-mini-model.
    COMMONS_OPENAI_POLICY_MODEL: "openai/test-base-model", COMMONS_OPENAI_POLICY_MINI_MODEL: "openai/test-mini-model", ...options.environment })) { saved[key] = process.env[key]; process.env[key] = value; }
  const post: ScenarioContext["post"] = async (body, personId = trip.organizerId) => {
    actAs(personId);
    const response = await routes.turns.POST(jsonRequest(trip.eventId, "/turns", "POST", body), params(trip.eventId));
    return { status: response.status, body: await response.json() };
  };
  const lookup: ScenarioContext["lookup"] = async (commandId, personId = trip.organizerId) => {
    actAs(personId);
    const response = await routes.turnLookup.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator/turns/${commandId}`), { params: Promise.resolve({ slug: trip.eventId, commandId }) });
    return { status: response.status, body: await response.json() };
  };
  const thread: ScenarioContext["thread"] = async (threadId, personId = trip.organizerId) => {
    actAs(personId);
    const response = await routes.turn.GET(new Request(`http://localhost/api/v1/commons/${trip.eventId}/coordinator?threadId=${threadId}`), params(trip.eventId));
    return response.json();
  };
  const command: ScenarioContext["command"] = (over = {}) => ({ commandId: randomUUID(), target: { kind: "new", threadId: randomUUID() }, inputMode: "text",
    text: "We're driving up from Denver on Friday. Where should the family eat dinner around 5 p.m.?", ...over });
  try { await run({ trip, routes, network, post, lookup, thread, command, next, infoLogs }); }
  finally {
    console.info = info; warnings.restore(); network.restore();
    for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    await trip.cleanup();
  }
}
