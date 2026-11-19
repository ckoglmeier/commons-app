import type { Expense, Reimbursement } from "@commons/contracts";

export type ParticipantBalance = {
  personId: string;
  paidCents: number;
  shareCents: number;
  reimbursedCents: number;
  receivedCents: number;
  netCents: number;
};

export type SuggestedTransfer = {
  fromPersonId: string;
  toPersonId: string;
  amountCents: number;
};

export function calculateParticipantBalances(
  personIds: string[],
  expenses: Expense[],
  reimbursements: Reimbursement[],
): ParticipantBalance[] {
  const balances = new Map(
    personIds.map((personId) => [
      personId,
      {
        personId,
        paidCents: 0,
        shareCents: 0,
        reimbursedCents: 0,
        receivedCents: 0,
        netCents: 0,
      },
    ]),
  );

  function balanceFor(personId: string) {
    const existing = balances.get(personId);
    if (existing) return existing;
    const created: ParticipantBalance = {
      personId,
      paidCents: 0,
      shareCents: 0,
      reimbursedCents: 0,
      receivedCents: 0,
      netCents: 0,
    };
    balances.set(personId, created);
    return created;
  }

  for (const expense of expenses) {
    const payer = balanceFor(expense.paidByPersonId);
    payer.paidCents += expense.amountCents;
    payer.netCents += expense.amountCents;
    for (const share of expense.shares) {
      const participant = balanceFor(share.personId);
      participant.shareCents += share.amountCents;
      participant.netCents -= share.amountCents;
    }
  }

  for (const reimbursement of reimbursements) {
    const sender = balanceFor(reimbursement.fromPersonId);
    const recipient = balanceFor(reimbursement.toPersonId);
    sender.reimbursedCents += reimbursement.amountCents;
    sender.netCents += reimbursement.amountCents;
    recipient.receivedCents += reimbursement.amountCents;
    recipient.netCents -= reimbursement.amountCents;
  }

  return [...balances.values()];
}
export function simplifyBalances(
  balances: ParticipantBalance[],
): SuggestedTransfer[] {
  const debtors = balances
    .filter((balance) => balance.netCents < 0)
    .map((balance) => ({ personId: balance.personId, amountCents: -balance.netCents }))
    .sort((left, right) => right.amountCents - left.amountCents || left.personId.localeCompare(right.personId));
  const creditors = balances
    .filter((balance) => balance.netCents > 0)
    .map((balance) => ({ personId: balance.personId, amountCents: balance.netCents }))
    .sort((left, right) => right.amountCents - left.amountCents || left.personId.localeCompare(right.personId));
  const transfers: SuggestedTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amountCents = Math.min(debtor.amountCents, creditor.amountCents);
    if (amountCents > 0) {
      transfers.push({
        fromPersonId: debtor.personId,
        toPersonId: creditor.personId,
        amountCents,
      });
    }
    debtor.amountCents -= amountCents;
    creditor.amountCents -= amountCents;
    if (debtor.amountCents === 0) debtorIndex += 1;
    if (creditor.amountCents === 0) creditorIndex += 1;
  }

  return transfers;
}
