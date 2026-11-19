import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { eq, inArray } from "drizzle-orm";
import { createDatabase } from "./client";
import {
  addCommonsExpense,
  addCommonsReimbursement,
  CommonsRepositoryError,
  confirmCommonsExpensesComplete,
  deleteCommonsExpense,
  deleteCommonsReimbursement,
  updateCommonsExpense,
  updateCommonsReimbursement,
} from "./pilot-repository";
import { commons, memberships, people } from "./schema";

const run = process.env.COMMONS_RUN_DATABASE_TESTS === "1";

test("a closed ledger blocks every expense and payment mutation", { skip: !run }, async () => {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  assert.ok(databaseUrl, "TEST_DATABASE_URL or DATABASE_URL is required");
  const database = createDatabase(databaseUrl);
  const personIds: string[] = [];
  let commonsId: string | undefined;
  try {
    const insertedPeople = await database.db.insert(people).values([
      { displayName: "Ledger Organizer", authUserId: randomUUID() },
      { displayName: "Ledger Traveler", authUserId: randomUUID() },
    ]).returning({ id: people.id });
    personIds.push(...insertedPeople.map((person) => person.id));
    const [event] = await database.db.insert(commons).values({
      slug: `closed-ledger-${randomUUID().slice(0, 8)}`,
      name: "Closed Ledger Test",
      timezone: "America/Denver",
      createdByPersonId: personIds[0]!,
    }).returning({ id: commons.id, slug: commons.slug });
    assert.ok(event);
    commonsId = event.id;
    await database.db.insert(memberships).values([
      { commonsId, personId: personIds[0]!, status: "active", role: "organizer" },
      { commonsId, personId: personIds[1]!, status: "active", role: "member" },
    ]);

    const options = { databaseUrl, actorPersonId: personIds[0]! };
    const expenseInput = {
      commandId: randomUUID(),
      title: "Dinner",
      amountCents: 10_000,
      paidByPersonId: personIds[0]!,
      occurredOn: "2027-06-24",
      category: "Food & drink",
      splitMethod: "equal" as const,
      shares: personIds.map((personId) => ({ personId, amountCents: 5_000 })),
    };
    const expenseSnapshot = await addCommonsExpense(event.slug, expenseInput, options);
    const expenseId = expenseSnapshot?.state.expenses[0]?.id;
    assert.ok(expenseId);
    const paymentInput = {
      commandId: randomUUID(),
      fromPersonId: personIds[1]!,
      toPersonId: personIds[0]!,
      amountCents: 5_000,
      occurredOn: "2027-06-25",
    };
    const paymentSnapshot = await addCommonsReimbursement(event.slug, paymentInput, options);
    const reimbursementId = paymentSnapshot?.state.reimbursements?.[0]?.id;
    assert.ok(reimbursementId);

    await confirmCommonsExpensesComplete(event.slug, {
      commandId: randomUUID(),
      scope: "group",
    }, options);

    const expectClosed = (operation: Promise<unknown>) => assert.rejects(
      operation,
      (error: unknown) => error instanceof CommonsRepositoryError
        && error.code === "expense_ledger_closed",
    );
    await expectClosed(addCommonsExpense(event.slug, { ...expenseInput, commandId: randomUUID() }, options));
    await expectClosed(updateCommonsExpense(event.slug, expenseId, { ...expenseInput, commandId: randomUUID() }, options));
    await expectClosed(deleteCommonsExpense(event.slug, expenseId, { commandId: randomUUID() }, options));
    await expectClosed(addCommonsReimbursement(event.slug, { ...paymentInput, commandId: randomUUID() }, options));
    await expectClosed(updateCommonsReimbursement(event.slug, reimbursementId, { ...paymentInput, commandId: randomUUID() }, options));
    await expectClosed(deleteCommonsReimbursement(event.slug, reimbursementId, { commandId: randomUUID() }, options));
  } finally {
    if (commonsId) await database.db.delete(commons).where(eq(commons.id, commonsId));
    if (personIds.length) await database.db.delete(people).where(inArray(people.id, personIds));
    await database.close();
  }
});
