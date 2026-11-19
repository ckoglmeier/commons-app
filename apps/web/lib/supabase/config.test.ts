import assert from "node:assert/strict";
import test from "node:test";
import { getLocalDevelopmentPilotActorId } from "./config";

test("allows the pilot actor only on a local development host", () => {
  assert.equal(getLocalDevelopmentPilotActorId({
    COMMONS_PILOT_ACTOR_ID: "pilot-person-id",
    NODE_ENV: "development",
    VERCEL: undefined,
    VERCEL_ENV: undefined,
  }), "pilot-person-id");

  for (const environment of [
    {
      COMMONS_PILOT_ACTOR_ID: "pilot-person-id",
      NODE_ENV: "production",
      VERCEL: undefined,
      VERCEL_ENV: undefined,
    },
    {
      COMMONS_PILOT_ACTOR_ID: "pilot-person-id",
      NODE_ENV: "development",
      VERCEL: "1",
      VERCEL_ENV: "preview",
    },
    {
      COMMONS_PILOT_ACTOR_ID: undefined,
      NODE_ENV: "development",
      VERCEL: undefined,
      VERCEL_ENV: undefined,
    },
  ] as const) {
    assert.equal(getLocalDevelopmentPilotActorId(environment), null);
  }
});
