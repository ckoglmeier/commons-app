import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import { CommandConflictError } from "./event-command";
import { updateCommonsDetails, CommonsRepositoryError } from "./pilot-repository";
import { commons, expenses, expenseShares, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";
test("trip currency changes are organizer-only, conflict checked and preserve saved spending", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL;
  assert.ok(databaseUrl);
  const database = createDatabase(databaseUrl);
  const tripId = randomUUID(), owner = randomUUID(), member = randomUUID(), expenseId = randomUUID();
  const slug = `currency-${tripId}`;
  try {
    await database.db.insert(people).values([{ id: owner, displayName: "Currency Owner" }, { id: member, displayName: "Currency Traveler" }]);
    await database.db.insert(commons).values({ id: tripId, slug, name: "Currency Test", timezone: "America/Denver", createdByPersonId: owner, currency: "USD" });
    await database.db.insert(memberships).values([{ commonsId: tripId, personId: owner, role: "organizer", status: "active" }, { commonsId: tripId, personId: member, role: "member", status: "active" }]);
    await database.db.insert(expenses).values({ id: expenseId, commonsId: tripId, title: "Existing dollars", amountCents: 12500, currency: "USD", paidByPersonId: owner, occurredOn: "2026-10-09", category: "Activity", splitMethod: "equal", balanceMode: "tracking_only", source: "web", sourceLabel: "Synthetic recorded expense" });
    await database.db.insert(expenseShares).values({ expenseId, personId: owner, amountCents: 0 });
    const command = { commandId: randomUUID(), title: "Currency Test", startsOn: null, endsOn: null, locationName: null, locationNames: [], balancesDisabled: false, currency: "EUR", expectedCurrency: "USD" };
    await assert.rejects(updateCommonsDetails(slug, { ...command, commandId: randomUUID() }, { databaseUrl, actorPersonId: member }), CommonsRepositoryError);
    const saved = await updateCommonsDetails(slug, command, { databaseUrl, actorPersonId: owner });
    assert.ok(saved);
    assert.equal(saved.commons.currency, "EUR");
    assert.equal(saved.state.expenses.find(expense => expense.id === expenseId)?.currency, "USD");
    assert.equal(saved.state.expenses.find(expense => expense.id === expenseId)?.amountCents, 12500);
    await assert.rejects(updateCommonsDetails(slug, { ...command, commandId: randomUUID(), currency: "GBP" }, { databaseUrl, actorPersonId: owner }), CommandConflictError);
    const legacy = await updateCommonsDetails(slug, { commandId: randomUUID(), title: "Renamed", startsOn: null, endsOn: null, locationName: null, balancesDisabled: false }, { databaseUrl, actorPersonId: owner });
    assert.ok(legacy);
    assert.equal(legacy.commons.currency, "EUR", "Older details clients cannot reset the currency");
    const replay = await updateCommonsDetails(slug, command, { databaseUrl, actorPersonId: owner });
    assert.ok(replay);
    assert.equal(replay.commons.name, "Renamed", "A retry cannot reapply old trip details");
  } finally {
    await database.db.delete(commons).where(eq(commons.id, tripId));
    await database.db.delete(people).where(inArray(people.id, [owner, member]));
    await database.close();
  }
});
