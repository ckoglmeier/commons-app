import type { CommonsSnapshot } from "@commons/contracts";
import { calculateParticipantBalances } from "@commons/domain";
import { commonsPath } from "./commons-route";

export function moneySummaryPath(tripId: string) {
  return `${commonsPath(tripId)}/money/summary/`;
}

export function moneySummaryShareUrl(origin: string, tripId: string) {
  return new URL(moneySummaryPath(tripId), origin).href;
}

/** A deliberate allowlist: never serialize the underlying trip snapshot into an export. */
export function buildMoneySummary(snapshot: CommonsSnapshot, generatedAt = new Date().toISOString()) {
  const { commons, participants, state } = snapshot;
  const balancesEnabled = !commons.balancesDisabled;
  const names = new Map(participants.map(person => [person.id, person.displayName]));
  for (const expense of state.expenses) if (!names.has(expense.paidByPersonId)) names.set(expense.paidByPersonId, expense.paidByName);
  for (const payment of state.reimbursements) {
    if (!names.has(payment.fromPersonId)) names.set(payment.fromPersonId, payment.fromPersonName);
    if (!names.has(payment.toPersonId)) names.set(payment.toPersonId, payment.toPersonName);
  }
  const nameOf = (id: string) => names.get(id) ?? "Former traveler";
  const recorded = state.expenses.filter(expense => expense.balanceMode !== "budget_only");
  const payments = balancesEnabled ? state.reimbursements : [];
  const currencies = [...new Set([...recorded.map(expense => expense.currency), ...payments.map(payment => payment.currency)])].sort();
  const active = participants.filter(person => person.membershipStatus === "active");
  return {
    tripId: commons.id,
    tripName: commons.name,
    generatedAt,
    timezone: commons.timezone,
    closed: Boolean(commons.expensesClosedAt) || (active.length > 0 && active.every(person => Boolean(person.expensesCompleteAt))),
    balancesEnabled,
    viewer: balancesEnabled ? { personId: snapshot.currentActor.id, name: snapshot.currentActor.displayName } : null,
    currencies: currencies.map(currency => {
      const expenses = recorded.filter(expense => expense.currency === currency);
      const reimbursements = payments.filter(payment => payment.currency === currency);
      // Missing balanceMode is the legacy allocated representation, also normalized by the repository.
      const allocated = expenses.filter(expense => expense.balanceMode !== "tracking_only");
      const involved = new Set([...allocated.flatMap(expense => [expense.paidByPersonId, ...expense.shares.map(share => share.personId)]), ...reimbursements.flatMap(payment => [payment.fromPersonId, payment.toPersonId])]);
      return {
        currency,
        recordedCents: expenses.reduce((sum, expense) => sum + expense.amountCents, 0),
        expenses: expenses.map(expense => ({
          id: expense.id, title: expense.title, amountCents: expense.amountCents,
          paidByPersonId: expense.paidByPersonId, paidByName: nameOf(expense.paidByPersonId),
          occurredOn: expense.occurredOn, status: expense.status,
          allocated: balancesEnabled && expense.balanceMode !== "tracking_only",
          shares: balancesEnabled && expense.balanceMode !== "tracking_only"
            ? expense.shares.map(share => ({ personId: share.personId, name: nameOf(share.personId), amountCents: share.amountCents })) : [],
        })).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id)),
        payments: reimbursements.map(payment => ({
          id: payment.id, occurredOn: payment.occurredOn, amountCents: payment.amountCents,
          fromPersonId: payment.fromPersonId, fromName: nameOf(payment.fromPersonId),
          toPersonId: payment.toPersonId, toName: nameOf(payment.toPersonId),
        })).sort((a, b) => a.occurredOn.localeCompare(b.occurredOn) || a.id.localeCompare(b.id)),
        balances: balancesEnabled ? calculateParticipantBalances([...involved], allocated, reimbursements)
          .map(balance => ({ ...balance, name: nameOf(balance.personId) }))
          .sort((a, b) => a.name.localeCompare(b.name) || a.personId.localeCompare(b.personId)) : [],
      };
    }),
  };
}

export type MoneySummary = ReturnType<typeof buildMoneySummary>;

export function moneySummaryViewerBalances(report: MoneySummary) {
  if (!report.viewer || !report.balancesEnabled) return [];
  return report.currencies.flatMap(group => {
    const balance = group.balances.find(person => person.personId === report.viewer!.personId);
    return balance ? [{ currency: group.currency, netCents: balance.netCents }] : [];
  });
}

export function moneySummaryAmount(cents: number, currency: string) {
  // Always preserve stored cents, including for currencies whose Intl default is zero decimals.
  return new Intl.NumberFormat("en-US", { style: "currency", currency, currencyDisplay: "code", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);
}

export function moneySummaryTimestamp(report: MoneySummary) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: report.timezone, hour12: true }).format(new Date(report.generatedAt));
}

export function moneySummaryDate(value: string) {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

function csvCell(value: string) {
  // Quoting alone doesn't stop spreadsheet formulas. Preserve text with an apostrophe prefix.
  // eslint-disable-next-line no-control-regex -- Leading control characters can conceal a spreadsheet formula.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function moneySummaryCsv(report: MoneySummary) {
  const rows: string[][] = [
    ["Type", "Date", "Description", "Person", "Other person", "Currency", "Amount", "Status", "Paid", "Share", "Payments sent", "Payments received", "Net", "Record ID", "Person ID", "Other person ID"],
    ["Summary", report.generatedAt, report.tripName, "", "", "", "", report.closed ? "Closed" : "Open"],
    ["Scope", "", `Saved records only; budget estimates excluded. ${report.balancesEnabled ? "Positive net is owed to the person; negative net is owed by them. Draft and disputed expenses are included with their saved status." : "Family trip: allocations, payments and balances omitted."}`],
  ];
  const amount = (cents: number) => (cents / 100).toFixed(2);
  for (const group of report.currencies) {
    rows.push(["Total", "", "Recorded expenses", "", "", group.currency, amount(group.recordedCents)]);
    for (const expense of group.expenses) {
      rows.push(["Expense", expense.occurredOn, expense.title, expense.paidByName, "", group.currency, amount(expense.amountCents), expense.status, "", "", "", "", "", expense.id, expense.paidByPersonId]);
      for (const share of expense.shares) rows.push(["Allocation", expense.occurredOn, expense.title, share.name, "", group.currency, amount(share.amountCents), expense.status, "", "", "", "", "", expense.id, share.personId]);
    }
    for (const payment of group.payments) rows.push(["Payment", payment.occurredOn, "Recorded reimbursement", payment.fromName, payment.toName, group.currency, amount(payment.amountCents), "Recorded", "", "", "", "", "", payment.id, payment.fromPersonId, payment.toPersonId]);
    for (const balance of group.balances) rows.push(["Balance", "", "Allocated expenses and recorded payments", balance.name, "", group.currency, "", "", amount(balance.paidCents), amount(balance.shareCents), amount(balance.reimbursedCents), amount(balance.receivedCents), amount(balance.netCents), "", balance.personId]);
  }
  return "\ufeff" + rows.map(row => Array.from({ length: 16 }, (_, index) => {
    const value = row[index] ?? "";
    // Only computed amount columns are numeric; all user-authored strings receive formula protection.
    return [6, 8, 9, 10, 11, 12].includes(index) && /^-?\d+\.\d{2}$/.test(value) ? value : csvCell(value);
  }).join(",")).join("\r\n") + "\r\n";
}
