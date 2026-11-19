import {
  AddExpenseCommandSchema,
  DeleteExpenseCommandSchema,
  UpdateExpenseCommandSchema,
} from "@commons/contracts";
import assert from "node:assert/strict";
import test from "node:test";

const validExpense = {
  commandId: "expense-command-1",
  title: "Dinner",
  amountCents: 10001,
  paidByPersonId: "person-1",
  occurredOn: "2026-06-04",
  category: "Food & drink",
  splitMethod: "equal" as const,
  shares: [
    { personId: "person-1", amountCents: 5001 },
    { personId: "person-2", amountCents: 5000 },
  ],
};

test("accepts an expense whose participant shares match the total", () => {
  assert.equal(AddExpenseCommandSchema.parse(validExpense).amountCents, 10001);
});

test("links a recorded expense to a trip plan when provided", () => {
  const command = AddExpenseCommandSchema.parse({
    ...validExpense,
    itineraryItemId: "plan-1",
  });
  assert.equal(command.itineraryItemId, "plan-1");
});

test("rejects an expense whose shares do not match the total", () => {
  assert.throws(() => AddExpenseCommandSchema.parse({
    ...validExpense,
    shares: [{ personId: "person-1", amountCents: 5000 }],
  }));
});

test("rejects duplicate participant shares", () => {
  assert.throws(() => AddExpenseCommandSchema.parse({
    ...validExpense,
    shares: [
      { personId: "person-1", amountCents: 5001 },
      { personId: "person-1", amountCents: 5000 },
    ],
  }));
});

test("updates use the same allocation checks as new expenses", () => {
  assert.equal(UpdateExpenseCommandSchema.parse(validExpense).shares.length, 2);
  assert.throws(() => UpdateExpenseCommandSchema.parse({
    ...validExpense,
    amountCents: 9999,
  }));
});

test("delete commands require an idempotency key", () => {
  assert.equal(DeleteExpenseCommandSchema.parse({ commandId: "delete-expense-1" }).commandId, "delete-expense-1");
  assert.throws(() => DeleteExpenseCommandSchema.parse({ commandId: "" }));
});
