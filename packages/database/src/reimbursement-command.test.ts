import {
  AddReimbursementCommandSchema,
  ConfirmExpensesCompleteCommandSchema,
  DeleteReimbursementCommandSchema,
  ReopenExpensesCommandSchema,
  UpdateReimbursementCommandSchema,
} from "@commons/contracts";
import assert from "node:assert/strict";
import test from "node:test";

const validPayment = {
  commandId: "payment-command-1",
  fromPersonId: "person-1",
  toPersonId: "person-2",
  amountCents: 4250,
  occurredOn: "2026-08-28",
};

test("accepts a recorded payment between two travelers", () => {
  assert.equal(AddReimbursementCommandSchema.parse(validPayment).amountCents, 4250);
  assert.equal(UpdateReimbursementCommandSchema.parse(validPayment).toPersonId, "person-2");
});

test("rejects a payment to the same traveler", () => {
  assert.throws(() => AddReimbursementCommandSchema.parse({
    ...validPayment,
    toPersonId: "person-1",
  }));
});

test("payment deletes and expense status changes require idempotency keys", () => {
  assert.equal(DeleteReimbursementCommandSchema.parse({ commandId: "delete-payment-1" }).commandId, "delete-payment-1");
  assert.equal(ReopenExpensesCommandSchema.parse({ commandId: "reopen-expenses-1" }).commandId, "reopen-expenses-1");
  assert.throws(() => DeleteReimbursementCommandSchema.parse({ commandId: "" }));
});

test("expense completion distinguishes a traveler confirmation from an organizer close", () => {
  assert.equal(ConfirmExpensesCompleteCommandSchema.parse({ commandId: "complete-self-1" }).scope, "self");
  assert.equal(ConfirmExpensesCompleteCommandSchema.parse({ commandId: "close-group-1", scope: "group" }).scope, "group");
});
