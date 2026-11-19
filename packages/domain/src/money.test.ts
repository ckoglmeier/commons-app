import type { Expense, Reimbursement } from "@commons/contracts";
import assert from "node:assert/strict";
import test from "node:test";
import { calculateParticipantBalances, simplifyBalances } from "./money";

test("only included participants owe a share", () => {
  const expense: Expense = {
    id: "expense-tennis",
    title: "Tennis",
    amountCents: 6564,
    currency: "USD",
    paidByPersonId: "rainey",
    paidByName: "Rainey",
    occurredOn: "2026-06-07",
    category: "Activity",
    status: "confirmed",
    splitMethod: "equal",
    receiptStatus: "not_attached",
    sourceLabel: "Imported from Splitwise",
    shares: [
      { personId: "rainey", amountCents: 3282 },
      { personId: "casey", amountCents: 3282 },
    ],
  };

  const balances = calculateParticipantBalances(
    ["casey", "rainey", "mike"],
    [expense],
    [],
  );

  assert.equal(balances.find((balance) => balance.personId === "casey")?.netCents, -3282);
  assert.equal(balances.find((balance) => balance.personId === "rainey")?.netCents, 3282);
  assert.equal(balances.find((balance) => balance.personId === "mike")?.netCents, 0);
});
test("recorded reimbursements reduce balances without moving money", () => {
  const expense: Expense = {
    id: "expense-house",
    title: "House",
    amountCents: 12000,
    currency: "USD",
    paidByPersonId: "mike",
    paidByName: "Mike",
    occurredOn: "2026-06-04",
    category: "Lodging",
    status: "confirmed",
    splitMethod: "equal",
    receiptStatus: "not_attached",
    sourceLabel: "Imported from Splitwise",
    shares: [
      { personId: "mike", amountCents: 6000 },
      { personId: "will", amountCents: 6000 },
    ],
  };
  const reimbursement: Reimbursement = {
    id: "reimbursement-one",
    fromPersonId: "will",
    fromPersonName: "Will",
    toPersonId: "mike",
    toPersonName: "Mike",
    amountCents: 2500,
    currency: "USD",
    occurredOn: "2026-06-20",
    sourceLabel: "Recorded in Splitwise · no money moved by Commons",
  };

  const balances = calculateParticipantBalances(
    ["mike", "will"],
    [expense],
    [reimbursement],
  );
  assert.equal(balances.find((balance) => balance.personId === "will")?.netCents, -3500);
  assert.deepEqual(simplifyBalances(balances), [
    { fromPersonId: "will", toPersonId: "mike", amountCents: 3500 },
  ]);
});
