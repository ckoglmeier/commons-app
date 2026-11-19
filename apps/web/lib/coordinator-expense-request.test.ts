import assert from "node:assert/strict";
import test from "node:test";
import type { TripContextSnapshot } from "@commons/contracts";
import { expenseConversionRequest, resolveExpenseActivity } from "./coordinator-expense-request";
const fact = { value: { itemId: "plan", title: "Balloon Fiesta Kids’ Day" } } as TripContextSnapshot["plans"][number];
test("expense preparation requires a current explicit named request", () => {
  for (const text of ["Convert Balloon Fiesta Kids’ Day to an expense", "Could you convert Balloon Fiesta Kids' Day into an expense?", "Please record an expense for Balloon Fiesta Kids’ Day"]) {
    assert.equal(resolveExpenseActivity(text, [fact])[0]?.itemId, "plan");
  }
  for (const text of ["How do I convert Balloon Fiesta Kids’ Day to an expense?", "Don't convert Balloon Fiesta Kids’ Day to an expense", "Robin said convert Balloon Fiesta Kids’ Day to an expense", '"Convert Balloon Fiesta Kids’ Day to an expense"', "Convert Balloon Fiesta Kids’ Day to an expense later", "If we go, convert Balloon Fiesta Kids’ Day to an expense"]) assert.equal(expenseConversionRequest(text), null, text);
});
test("expense requests cannot invent a record or silently resolve duplicate titles", () => {
  assert.equal(resolveExpenseActivity("Convert Other activity to an expense", [fact]).length, 0);
  assert.equal(resolveExpenseActivity("Convert Balloon Fiesta Kids’ Day to an expense", [fact, { ...fact, value: { ...fact.value, itemId: "second" } }]).length, 2);
});
test("conversion preserves an activity title's leading article", () => {
  assert.equal(expenseConversionRequest("Convert The Art Experience to an expense"), "The Art Experience");
  assert.equal(expenseConversionRequest("Convert the budget line item for Balloon Fiesta Kids’ Day to an expense"), "Balloon Fiesta Kids' Day");
});
