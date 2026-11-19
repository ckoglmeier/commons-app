import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeCommonsCronRequest,
  commonsSiteOrigin,
  coordinatorTripChangesEnabled,
  groupMessagesEnabled,
  readCommonsRuntimeEnvironment,
  requireCommonsDatabaseUrl,
} from "./runtime-environment";

const productionEnvironment = {
  NODE_ENV: "production",
  VERCEL: "1",
  VERCEL_ENV: "production",
  DATABASE_URL: "postgresql://database.example/commons",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable",
  COMMONS_INVITATION_TOKEN_KEY: Buffer.alloc(32).toString("base64"),
  CRON_SECRET: "a-long-production-secret",
  NEXT_PUBLIC_SITE_URL: "https://www.commons.travel/path",
} satisfies NodeJS.ProcessEnv;

test("production configuration fails closed when a required primitive is missing", () => {
  const missingDatabase = { ...productionEnvironment, DATABASE_URL: undefined };
  assert.throws(
    () => readCommonsRuntimeEnvironment(missingDatabase),
    /DATABASE_URL is required on Vercel/,
  );
});

test("production rejects the local pilot actor escape hatch", () => {
  assert.throws(
    () => readCommonsRuntimeEnvironment({
      ...productionEnvironment,
      COMMONS_PILOT_ACTOR_ID: "00000000-0000-4000-8000-000000000001",
    }),
    /limited to explicit local development/,
  );
});

test("local demo mode permits an intentionally absent database and auth provider", () => {
  const environment = { NODE_ENV: "development" } satisfies NodeJS.ProcessEnv;
  assert.equal(readCommonsRuntimeEnvironment(environment).DATABASE_URL, undefined);
  assert.throws(() => requireCommonsDatabaseUrl(environment), /not configured/);
  assert.equal(commonsSiteOrigin("http://localhost:3000/path", environment), "http://localhost:3000");
});

test("site origins are canonicalized from validated configuration", () => {
  assert.equal(commonsSiteOrigin(undefined, productionEnvironment), "https://www.commons.travel");
});

test("preview deployments use their generated Vercel hostname", () => {
  const preview = {
    ...productionEnvironment,
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SITE_URL: undefined,
    VERCEL_URL: "commons-preview.vercel.app",
  } satisfies NodeJS.ProcessEnv;
  assert.equal(commonsSiteOrigin(undefined, preview), "https://commons-preview.vercel.app");
});

test("cron authorization has one fail-closed owner", () => {
  const request = new Request("https://www.commons.travel/api/internal/work", {
    headers: { authorization: `Bearer ${productionEnvironment.CRON_SECRET}` },
  });
  assert.deepEqual(authorizeCommonsCronRequest(request, productionEnvironment), {
    authorized: true,
    origin: "https://www.commons.travel",
  });
  const denied = authorizeCommonsCronRequest(
    new Request(request.url, { headers: { authorization: "Bearer wrong" } }),
    productionEnvironment,
  );
  assert.deepEqual(denied, { authorized: false, status: 401, error: "Unauthorized." });
});

test("coordinator onboarding is opt-in independently of background research", () => {
  const defaults = readCommonsRuntimeEnvironment(productionEnvironment);
  assert.equal(defaults.COMMONS_COORDINATOR_ONBOARDING_ENABLED, "false");
  assert.equal(defaults.COMMONS_COORDINATOR_ADVISORY_MODEL, "openai/gpt-6-astra");
  const enabled = readCommonsRuntimeEnvironment({ ...productionEnvironment, COMMONS_COORDINATOR_ONBOARDING_ENABLED: "true" });
  assert.equal(enabled.COMMONS_COORDINATOR_ONBOARDING_ENABLED, "true");
  assert.notEqual(enabled.COMMONS_DURABLE_RESEARCH_ENABLED, "true");
});

test("GPT-Live coordinator testing is explicitly enabled", () => {
  const defaults = readCommonsRuntimeEnvironment(productionEnvironment);
  assert.equal(defaults.COMMONS_COORDINATOR_LIVE_ENABLED, "false");
  assert.equal(defaults.COMMONS_COORDINATOR_LIVE_MODEL, "gpt-live-1");
  const enabled = readCommonsRuntimeEnvironment({ ...productionEnvironment, COMMONS_COORDINATOR_LIVE_ENABLED: "true" });
  assert.equal(enabled.COMMONS_COORDINATOR_LIVE_ENABLED, "true");
});

test("group messages are paused unless the flag is explicitly true, and an odd value fails closed", () => {
  const env = (values: Record<string, string>) => values as unknown as NodeJS.ProcessEnv;
  assert.equal(groupMessagesEnabled(env({})), false);
  assert.equal(readCommonsRuntimeEnvironment(env({})).COMMONS_GROUP_MESSAGES_ENABLED, "false");
  assert.equal(groupMessagesEnabled(env({ COMMONS_GROUP_MESSAGES_ENABLED: "false" })), false);
  assert.equal(groupMessagesEnabled(env({ COMMONS_GROUP_MESSAGES_ENABLED: "true" })), true);
  assert.equal(groupMessagesEnabled(env({ COMMONS_GROUP_MESSAGES_ENABLED: " true " })), true);
  assert.equal(groupMessagesEnabled(env({ COMMONS_GROUP_MESSAGES_ENABLED: "yes" })), false);
  assert.equal(groupMessagesEnabled(env({ COMMONS_GROUP_MESSAGES_ENABLED: "TRUE" })), false);
});

test("coordinator trip changes are on for every trip; only the global switch set to exactly false turns them off", () => {
  const env = (values: Record<string, string> = {}) => values as NodeJS.ProcessEnv;
  const anyTrip = "95000000-0000-4000-8000-0000000000a1";
  assert.equal(coordinatorTripChangesEnabled(anyTrip, env()), true, "unset means enabled");
  assert.equal(coordinatorTripChangesEnabled("another-trip", env()), true, "no trip identifier gates the feature");
  assert.equal(coordinatorTripChangesEnabled(anyTrip, env({ COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: "true" })), true);
  assert.equal(coordinatorTripChangesEnabled(anyTrip, env({ COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: "" })), true);
  assert.equal(coordinatorTripChangesEnabled(anyTrip, env({ COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: "False" })), true, "only the exact lowercase word is the rollback");
  assert.equal(coordinatorTripChangesEnabled(anyTrip, env({ COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: "false" })), false);
  assert.equal(coordinatorTripChangesEnabled("another-trip", env({ COMMONS_COORDINATOR_TRIP_CHANGES_ENABLED: "false" })), false, "the switch is global");
});


test("deeper research is opt-in independently of API-key presence and rejects unqualified presets", () => {
  assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test", PERPLEXITY_API_KEY: "synthetic-key" }).COMMONS_DEEP_RESEARCH_PROVIDER, "tavily");
  assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test", COMMONS_DEEP_RESEARCH_PROVIDER: "perplexity", PERPLEXITY_API_KEY: "synthetic-key" }).COMMONS_DEEP_RESEARCH_PROVIDER, "perplexity");
  assert.throws(() => readCommonsRuntimeEnvironment({ NODE_ENV: "test", COMMONS_DEEP_RESEARCH_PROVIDER: "low" }));
});


test("poll assistance keeps its explicit activation gate and accepts auto routing or a pinned model", () => {
  assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test" }).COMMONS_POLL_MODEL, undefined);
  for (const model of ["auto", "gpt-6-luna", "gpt-6.1-terra", "custom-approved-model"]) {
    assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test", COMMONS_POLL_MODEL: model }).COMMONS_POLL_MODEL, model);
  }
});
