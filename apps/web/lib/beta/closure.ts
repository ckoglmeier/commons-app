import type { CommonsState } from "@commons/contracts";
import { currencyLedger } from "../currency-ledger";

export type PaymentReportRow = {
  id: string;
  reportedByPersonId: string;
  toPersonId: string;
  currency: string;
  amountCents: number;
  status: "reported" | "recorded" | "dismissed";
};

export type CurrencyReconciliation = {
  currency: string;
  /** Payments still needed to settle recorded expenses, from recorded reimbursements only. Each currency stands alone. */
  openTransfers: { fromPersonId: string; toPersonId: string; amountCents: number }[];
  openCents: number;
  reconciled: boolean;
  /** Reports awaiting a receipt. They are shown beside the open amount and never subtracted from it. */
  pendingReports: PaymentReportRow[];
  pendingReportCents: number;
};

/**
 * Per-currency reconciliation for closing a ledger. It reuses the existing currency ledger, so it inherits its rules: budget-only costs are
 * excluded, family trips with balances off have nothing to reconcile, and currencies are never converted or netted against each other.
 * A payment report is a claim: it appears as pending and never reduces what is open.
 */
export function ledgerReconciliation(input: {
  state: Pick<CommonsState, "expenses" | "reimbursements">;
  personIds: string[];
  balancesDisabled?: boolean;
  reports?: PaymentReportRow[];
}): CurrencyReconciliation[] {
  const reports = input.reports ?? [];
  const currencies = [...new Set([
    ...input.state.expenses.filter(row => row.balanceMode !== "budget_only").map(row => row.currency),
    ...input.state.reimbursements.map(row => row.currency),
    ...reports.filter(row => row.status === "reported").map(row => row.currency),
  ])].sort();
  return currencies.map(currency => {
    const ledger = currencyLedger(input.state, currency, input.personIds, input.balancesDisabled);
    const pendingReports = reports.filter(row => row.status === "reported" && row.currency === currency);
    const openCents = ledger.transfers.reduce((sum, transfer) => sum + transfer.amountCents, 0);
    return {
      currency,
      openTransfers: ledger.transfers,
      openCents,
      reconciled: ledger.transfers.length === 0,
      pendingReports,
      pendingReportCents: pendingReports.reduce((sum, row) => sum + row.amountCents, 0),
    };
  });
}

export type ClosureReadiness = {
  ready: boolean;
  /** Plain sentences for each currency that is not settled, in the product voice. */
  blockers: string[];
  reconciliation: CurrencyReconciliation[];
};

const money = (cents: number, currency: string) => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(cents / 100);

export function closureReadiness(input: Parameters<typeof ledgerReconciliation>[0]): ClosureReadiness {
  const reconciliation = ledgerReconciliation(input);
  const blockers = reconciliation.flatMap(row => {
    const lines: string[] = [];
    if (!row.reconciled) lines.push(`${row.currency}: ${money(row.openCents, row.currency)} still to be paid back.`);
    if (row.pendingReports.length) lines.push(`${row.currency}: ${row.pendingReports.length} ${row.pendingReports.length === 1 ? "payment report is" : "payment reports are"} waiting for a recorded receipt.`);
    return lines;
  });
  return { ready: blockers.length === 0, blockers, reconciliation };
}

/** "Plan the next one" is for people on a trip that has ended or whose ledger is closed. It is an invitation, never an enrollment. */
export function planNextVisible(input: { endsOn: string | null; ledgerClosed: boolean; today: string; isMember: boolean }) {
  if (!input.isMember) return false;
  return input.ledgerClosed || Boolean(input.endsOn && input.endsOn < input.today);
}

/** Payments and wrap-up matter once someone owes something or a payment has happened. A fee nobody shares isn't that. */
export function moneyWrapUpRelevant(input: { reconciliation: Array<{ reconciled: boolean; pendingReports: unknown[] }>; reportCount: number; reimbursementCount: number; ledgerClosed: boolean }) {
  return input.ledgerClosed || input.reportCount > 0 || input.reimbursementCount > 0
    || input.reconciliation.some(row => !row.reconciled || row.pendingReports.length > 0);
}
