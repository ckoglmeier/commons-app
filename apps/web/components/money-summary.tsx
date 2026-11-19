"use client";

import { useState } from "react";
import { moneySummaryAmount, moneySummaryCsv, moneySummaryDate, moneySummaryShareUrl, moneySummaryTimestamp, moneySummaryViewerBalances, type MoneySummary } from "../lib/money-summary";

export function MoneySummaryView({ summary }: { summary: MoneySummary }) {
  const [downloadError, setDownloadError] = useState(false);
  const [shareNotice, setShareNotice] = useState("");
  const [manualLink, setManualLink] = useState("");
  const personalBalances = moneySummaryViewerBalances(summary);
  async function share() {
    const url = moneySummaryShareUrl(window.location.origin, summary.tripId);
    try {
      await navigator.clipboard.writeText(url);
      setManualLink("");
      setShareNotice("Ledger link copied. Paste it into your message to the group.");
    } catch {
      setManualLink(url);
      setShareNotice("Copy couldn’t complete. Select and copy the link below.");
    }
  }
  function download() {
    setDownloadError(false);
    try {
      const url = URL.createObjectURL(new Blob([moneySummaryCsv(summary)], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `commons-ledger-${summary.generatedAt.slice(0, 10)}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError(true); }
  }
  return <main className="cm-document-canvas ledger-report-page"><div className="cm-document-page"><article className="cm-document-paper ledger-report">
    <nav className="ledger-report-controls cm-document-tools" aria-label="Ledger summary">
      <a className="cm-document-quiet-action" href={`/c/${summary.tripId}?arrival=0&view=money`}>Back to Money</a>
      <div><details className="ledger-report-export"><summary className="cm-document-quiet-action">Export</summary><div><button className="cm-document-quiet-action" type="button" onClick={() => window.print()}>Print / Save PDF</button><button className="cm-document-quiet-action" type="button" onClick={download}>Download CSV</button></div></details><button className="view-primary-action" type="button" onClick={() => void share()}>Share ledger</button></div>
    </nav>
    <div className="ledger-report-share">
      <p>{summary.sample ? "Share this sample ledger with anyone." : summary.balancesEnabled ? "Share with your trip. Members sign in to see the latest saved ledger and their own balance." : "Share with your trip. Members sign in to see the latest saved ledger."}</p>
      {shareNotice ? <p role="status">{shareNotice}</p> : null}
      {manualLink ? <label>Ledger link<input readOnly value={manualLink} onFocus={event => event.currentTarget.select()} /></label> : null}
    </div>
    {downloadError ? <p role="alert">The download couldn’t start. Try again, or use Print / Save PDF.</p> : null}
    <header className="ledger-report-heading">
      <p className="ledger-report-eyebrow">Commons{summary.sample ? " · Sample trip" : ""} · {summary.closed ? "Ledger closed" : "Ledger open"}</p>
      <h1>Trip ledger</h1>
      <p className="ledger-report-trip">{summary.tripName}</p>
      <p>Saved records as of {moneySummaryTimestamp(summary)} ({summary.timezone}).</p>
      {summary.sample ? <p>Sample ledger. Changes made in the demo are not included.</p> : null}
      <p>{summary.balancesEnabled ? "Recorded expenses, shared splits and recorded payments. Budget estimates are excluded." : "Family trip · Balances off. Recorded expenses only; budget estimates are excluded."}</p>
    </header>
    {summary.viewer ? <section className="ledger-report-personal" aria-label="Your balance">
      <h2>Your balance</h2><p>For {summary.viewer.name}</p>
      {personalBalances.length ? <ul>{personalBalances.map(balance => <li key={balance.currency}><strong>{balance.netCents === 0 ? `${balance.currency} · You’re even` : `${balance.netCents < 0 ? "You owe" : "You get back"} ${moneySummaryAmount(Math.abs(balance.netCents), balance.currency)}`}</strong></li>)}</ul> : <p>No allocated balance for you yet.</p>}
      {personalBalances.length ? <p>Based on recorded expenses and payments below, including any draft or disputed expenses.</p> : null}
    </section> : null}
    {!summary.currencies.length ? <p className="ledger-report-empty">No recorded expenses or payments yet.</p> : null}
    {summary.currencies.map(group => <section className="ledger-report-currency" key={group.currency} aria-label={`${group.currency} ledger`}>
      <div className="ledger-report-total"><div><h2>{group.currency}</h2><p>{group.expenses.length} recorded {group.expenses.length === 1 ? "expense" : "expenses"}</p></div><strong>{moneySummaryAmount(group.recordedCents, group.currency)}</strong></div>
      <section aria-label={`${group.currency} expenses`}>
        <h3>Expenses</h3>
        {group.expenses.length ? <ul className="ledger-report-records">{group.expenses.map(expense => <li key={expense.id}>
          <div className="ledger-report-record-heading"><h4>{expense.title}</h4><strong>{moneySummaryAmount(expense.amountCents, group.currency)}</strong></div>
          <p>{moneySummaryDate(expense.occurredOn)} · Paid by {expense.paidByName} · <span className={expense.status !== "confirmed" ? "ledger-report-attention" : ""}>{expense.status === "confirmed" ? "Confirmed" : expense.status === "draft" ? "Draft" : "Disputed"}</span></p>
          {expense.allocated ? <dl className="ledger-report-splits" aria-label={`Allocation for ${expense.title}`}>{expense.shares.map(share => <div key={share.personId}><dt>{share.name}</dt><dd>{moneySummaryAmount(share.amountCents, group.currency)}</dd></div>)}</dl> : summary.balancesEnabled ? <p>No allocation</p> : null}
        </li>)}</ul> : <p>No expenses recorded in this currency.</p>}
      </section>
      {summary.balancesEnabled ? <>
        <section aria-label={`${group.currency} payments`}><h3>Recorded payments</h3><p>Reimbursements recorded by travelers. Commons does not send money.</p>
          {group.payments.length ? <ul className="ledger-report-records">{group.payments.map(payment => <li key={payment.id}><div className="ledger-report-record-heading"><h4>{payment.fromName} → {payment.toName}</h4><strong>{moneySummaryAmount(payment.amountCents, group.currency)}</strong></div><p>{moneySummaryDate(payment.occurredOn)}</p></li>)}</ul> : <p>No payments recorded.</p>}
        </section>
        <section aria-label={`${group.currency} balances`}><h3>Balances</h3><p>Includes allocated expenses and recorded payments. Draft and disputed expenses keep their status.</p>
          {group.balances.length ? <ul className="ledger-report-records">{group.balances.map(balance => <li key={balance.personId}><div className="ledger-report-record-heading"><h4>{balance.name}</h4><strong>{balance.netCents === 0 ? "Even" : `${balance.netCents > 0 ? "Gets back" : "Owes"} ${moneySummaryAmount(Math.abs(balance.netCents), group.currency)}`}</strong></div>
            <dl className="ledger-report-splits"><div><dt>Paid for expenses</dt><dd>{moneySummaryAmount(balance.paidCents, group.currency)}</dd></div><div><dt>Share of expenses</dt><dd>{moneySummaryAmount(balance.shareCents, group.currency)}</dd></div><div><dt>Payments sent</dt><dd>{moneySummaryAmount(balance.reimbursedCents, group.currency)}</dd></div><div><dt>Payments received</dt><dd>{moneySummaryAmount(balance.receivedCents, group.currency)}</dd></div></dl>
          </li>)}</ul> : <p>No allocated balances.</p>}
        </section>
      </> : null}
    </section>)}
    <footer>Each currency is shown separately. Private booking details, receipt documents and notes are excluded. This summary does not close the ledger.</footer>
  </article></div></main>;
}
