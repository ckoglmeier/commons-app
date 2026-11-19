import type { CommonsState } from "@commons/contracts";
import { calculateParticipantBalances, simplifyBalances } from "@commons/domain";

/** A currency is an accounting boundary; no cross-currency settlement or implied FX. */
export function currencyLedger(state: Pick<CommonsState, "expenses" | "reimbursements">, currency: string, personIds: string[], balancesDisabled = false) {
  const expenses = state.expenses.filter(row => row.currency === currency);
  const actualExpenses = expenses.filter(row => row.balanceMode !== "budget_only");
  const reimbursements = balancesDisabled ? [] : state.reimbursements.filter(row => row.currency === currency);
  const balanceExpenses = balancesDisabled ? [] : actualExpenses.filter(row => (row.balanceMode ?? "allocated") === "allocated");
  const balances = balancesDisabled ? [] : calculateParticipantBalances(personIds, balanceExpenses, reimbursements);
  return { expenses, actualExpenses, reimbursements, balances, transfers: simplifyBalances(balances) };
}
