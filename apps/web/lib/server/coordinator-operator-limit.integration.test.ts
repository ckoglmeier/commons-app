import test from "node:test";
import assert from "node:assert/strict";
import { processedCommands } from "@commons/database";
import { actAs, databaseTestsEnabled, eq, withCoordinatorScenario, withTestDatabase } from "./coordinator-route-harness";

// Operators (COMMONS_OPERATOR_EMAIL_ALLOWLIST) test in production on real trips. Their turns must not be refused by, or use up, the hourly inference
// allowance a trip's organizers share. Everyone else keeps the limit.
const skip = !databaseTestsEnabled;

test("an operator is never refused by the hourly limit and uses none of the trip's allowance; organizers keep the limit", { skip }, () => withCoordinatorScenario(async s => {
  const quotaRows = () => withTestDatabase(async db => (await db.select().from(processedCommands).where(eq(processedCommands.commonsId, s.trip.eventId)))
    .filter(row => (row.result as { kind?: string }).kind === "poll_inference").length);
  for (let index = 0; index < 10; index += 1) assert.equal((await s.post(s.command({ text: `Where should we eat on night ${index + 1}?` }))).body.status, "completed");
  await withTestDatabase(db => db.insert(processedCommands).values(Array.from({length:90},(_,index)=>({commonsId:s.trip.eventId,commandId:`seed-${index}`,result:{kind:"poll_inference",actorPersonId:s.trip.organizerId}}))));
  assert.equal(await quotaRows(), 100);
  const refused = await s.post(s.command({ text: "And lunch on Saturday?" }));
  assert.equal(refused.status, 429);
  assert.equal(refused.body.error.code, "rate_limited");

  actAs(s.trip.organizerId);
  // Loaded after the scenario has stubbed `server-only`.
  const { runCoordinatorTurn } = await import("./coordinator-turn-service");
  const operator = await runCoordinatorTurn(s.trip.eventId, s.command({ text: "And lunch on Saturday?" }), { isOperator: async () => true });
  assert.equal(operator.status, "completed");
  assert.equal(await quotaRows(), 100, "the operator's turn used none of the allowance");

  const stillLimited = await s.post(s.command({ text: "What about Sunday brunch?" }));
  assert.equal(stillLimited.body.error.code, "rate_limited", "organizers still have the limit");
}));
