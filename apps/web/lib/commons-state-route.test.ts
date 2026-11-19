import assert from "node:assert/strict";
import test from "node:test";
import { createCommonsStateRouteHandler } from "./commons-state-route";
import { pilotSnapshot } from "./pilot-fixture";
import {
  CommonsAuthenticationRequiredError,
  CommonsMembershipRequiredError,
} from "./server/commons-access-errors";

const request = new Request("https://commons.test/api/v1/commons/example/state");
const context = (slug: string) => ({ params: Promise.resolve({ slug }) });

test("state route serves the named public demo", async () => {
  const handler = createCommonsStateRouteHandler({
    loadSnapshot: async () => pilotSnapshot,
    dataMode: () => "demo",
  });

  const response = await handler(request, context(pilotSnapshot.commons.slug));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dataMode, "demo");
  assert.equal(body.snapshot.commons.id, pilotSnapshot.commons.id);
});

test("state route denies an unauthenticated private request", async () => {
  const handler = createCommonsStateRouteHandler({
    loadSnapshot: async () => { throw new CommonsAuthenticationRequiredError(); },
    dataMode: () => "database",
  });

  const response = await handler(request, context("private-trip"));
  assert.equal(response.status, 401);
});

test("state route denies an authenticated non-member", async () => {
  const handler = createCommonsStateRouteHandler({
    loadSnapshot: async () => { throw new CommonsMembershipRequiredError(); },
    dataMode: () => "database",
  });

  const response = await handler(request, context("private-trip"));
  assert.equal(response.status, 403);
});

test("state route serves a private trip to an authenticated member", async () => {
  const privateSnapshot = {
    ...pilotSnapshot,
    commons: {
      ...pilotSnapshot.commons,
      id: "private-trip-id",
      slug: "private-trip",
      name: "Private Trip",
    },
  };
  const handler = createCommonsStateRouteHandler({
    loadSnapshot: async () => privateSnapshot,
    dataMode: () => "database",
  });

  const response = await handler(request, context(privateSnapshot.commons.slug));
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.dataMode, "database");
  assert.equal(body.snapshot.commons.id, privateSnapshot.commons.id);
});
