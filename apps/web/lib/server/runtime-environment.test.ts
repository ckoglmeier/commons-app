import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizeCommonsCronRequest,
  commonsSiteOrigin,
  readCommonsRuntimeEnvironment,
  requireCommonsDatabaseUrl,
  textMessagingAvailable,
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

test("a setting left blank counts as not set, as an env file copied from .env.example leaves several", () => {
  const environment = {
    NODE_ENV: "development",
    DATABASE_URL: "postgresql://postgres@127.0.0.1:5432/commons",
    NEXT_PUBLIC_SUPABASE_URL: "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
    SUPABASE_SERVICE_ROLE_KEY: "  ",
    CRON_SECRET: "",
    COMMONS_INVITATION_TOKEN_KEY: "",
    COMMONS_EMAIL_SEND_MODE: "",
    RESEND_API_KEY: "",
    COMMONS_EMAIL_FROM: "",
  } satisfies NodeJS.ProcessEnv;
  const parsed = readCommonsRuntimeEnvironment(environment);
  assert.equal(parsed.DATABASE_URL, "postgresql://postgres@127.0.0.1:5432/commons");
  for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "COMMONS_INVITATION_TOKEN_KEY", "COMMONS_EMAIL_SEND_MODE"] as const) {
    assert.equal(parsed[name], undefined, `${name} is blank, so it is unset`);
  }
  // A blank secret is still a missing secret: the daily job stays closed.
  assert.deepEqual(authorizeCommonsCronRequest(new Request("http://localhost:3000/api/internal/daily/"), environment), { authorized: false, status: 503, error: "CRON_SECRET is not configured." });
  // A real problem is still reported.
  assert.throws(() => readCommonsRuntimeEnvironment({ ...environment, NEXT_PUBLIC_SUPABASE_URL: "not a url" }), /Invalid Commons server configuration/);
  // On Vercel a blank required setting is still a missing one.
  assert.throws(() => readCommonsRuntimeEnvironment({ ...productionEnvironment, CRON_SECRET: " " }), /CRON_SECRET is required on Vercel/);
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

test("texting is configured only when all three Twilio settings are set", () => {
  const all = { TWILIO_ACCOUNT_SID: "AC-synthetic", TWILIO_AUTH_TOKEN: "synthetic", TWILIO_MESSAGING_SERVICE_SID: "MG-synthetic" };
  assert.equal(textMessagingAvailable({}), false);
  assert.equal(textMessagingAvailable({ ...all, TWILIO_AUTH_TOKEN: "" }), false);
  assert.equal(textMessagingAvailable(all), true);
});

test("poll assistance keeps its explicit activation gate and accepts auto routing or a pinned model", () => {
  assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test" }).COMMONS_POLL_MODEL, undefined);
  for (const model of ["auto", "gpt-6-luna", "gpt-6.1-terra", "custom-approved-model"]) {
    assert.equal(readCommonsRuntimeEnvironment({ NODE_ENV: "test", COMMONS_POLL_MODEL: model }).COMMONS_POLL_MODEL, model);
  }
});
