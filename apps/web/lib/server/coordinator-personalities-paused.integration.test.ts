import test from "node:test";
import assert from "node:assert/strict";
import { actAs, databaseTestsEnabled, params, withCoordinatorScenario } from "./coordinator-route-harness";

// Personalities are paused (CK, September 30): every reply comes from Commons on the policy's conversation model (gpt-4.1-mini by default), with no
// style instruction, even where event setup is on. COMMONS_COORDINATOR_PERSONALITIES_ENABLED=true brings the styles and their advisory model back.
const skip = !databaseTestsEnabled;
const styled = (body: { messages?: Array<{ role: string; content: string }> }) => (body.messages ?? []).some(message => message.content.startsWith("Voice specification"));

test("personalities paused: answers use the conversation model and the Commons voice, and the style settings are closed", { skip }, () => withCoordinatorScenario(async s => {
  const reply = await s.post(s.command({ text: "Where should we eat the first night?" }));
  assert.equal(reply.body.status, "completed", JSON.stringify(reply.body));
  const call = s.network.providerCalls.at(-1)!;
  assert.equal(call.body.model, "test-base-model", "the conversation model, not the advisory model");
  assert.equal(styled(call.body), false, "no personality instruction");
  actAs(s.trip.organizerId);
  const settings = await (await import("../../app/api/v1/commons/[slug]/coordinator/settings/route")).GET(new Request(`http://localhost/api/v1/commons/${s.trip.eventId}/coordinator/settings`), params(s.trip.eventId));
  assert.equal(settings.status, 404);
}, { environment: { COMMONS_COORDINATOR_ONBOARDING_ENABLED: "true" } }));

test("personalities switched back on: styled answers use the advisory model with the style instruction", { skip }, () => withCoordinatorScenario(async s => {
  const reply = await s.post(s.command({ text: "Where should we eat the first night?" }));
  assert.equal(reply.body.status, "completed", JSON.stringify(reply.body));
  const call = s.network.providerCalls.at(-1)!;
  assert.equal(call.body.model, "gpt-6-astra");
  assert.equal(styled(call.body), true);
}, { environment: { COMMONS_COORDINATOR_ONBOARDING_ENABLED: "true", COMMONS_COORDINATOR_PERSONALITIES_ENABLED: "true" } }));
