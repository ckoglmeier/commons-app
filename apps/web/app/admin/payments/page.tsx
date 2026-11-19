import Link from "next/link";
import { notFound } from "next/navigation";
import { CommonsWordmark } from "@commons/ui";
import { CommonsOperatorRequiredError, loadOperatorTripPayments } from "@/lib/server/operator";
import { betaActivationEnabled } from "@/lib/trip-activation/provider";
import { resolveRefundHold, retryFeeExpense } from "../actions";

export const dynamic = "force-dynamic";
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const FAILURE: Record<string, string> = { expired: "Last checkout expired", async_failed: "Last payment failed" };

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ page?: string | string[] }> }) {
  if (!betaActivationEnabled()) notFound();
  const value = (await searchParams).page;
  const page = typeof value === "string" && /^\d{1,4}$/.test(value) ? Number(value) : 0;
  let payments: Awaited<ReturnType<typeof loadOperatorTripPayments>>;
  try { payments = await loadOperatorTripPayments(page); }
  catch (error) { if (error instanceof CommonsOperatorRequiredError) notFound(); throw error; }
  return <main className="operator-shell">
    <header className="creation-header"><Link className="entry-brand" href="/"><CommonsWordmark /></Link><div className="event-creation-nav"><Link href="/admin">Back to admin</Link></div></header>
    <div className="operator-content">
      <header className="operator-intro"><h1>Payments &amp; refunds</h1><p>Review trip fees and refunds. Issue refunds with the payment provider; review shared costs in the trip’s Money.</p></header>
      <p role="status">Test mode only. No charge or refund can be issued here.</p>
      <section className="operator-section" aria-label="Trip payments">
        {payments.rows.length ? payments.rows.map(row => <article className="operator-row" key={row.draftId}>
          <div>
            <strong>{row.tripName || "Untitled trip"}</strong>
            <span>Organizer: {row.organizerName}</span>
            <span>{row.status === "paid" ? `Paid ${money(row.amountCents)}` : row.status === "processing" ? "Confirming payment" : `Not paid · ${money(row.amountCents)} fee`}{row.failureCode ? ` · ${FAILURE[row.failureCode] ?? row.failureCode}` : ""}</span>
            <span>{row.paidAt ? `Paid ${row.paidAt.toISOString().slice(0, 10)}` : `Started ${row.createdAt.toISOString().slice(0, 10)}`} · Tax included: {row.taxAmountCents === null ? "Unknown" : money(row.taxAmountCents)}</span>
            <span>Refunded: {money(row.refundedCents)}{row.refundCount ? ` across ${row.refundCount} refund${row.refundCount === 1 ? "" : "s"}` : ""}{row.refundPending ? " · pending" : ""}{row.status === "paid" ? ` · Net fee: ${money(row.amountCents - row.refundedCents)}` : ""}</span>
            <span>{!row.tripId ? "Private draft · no trip yet" : row.status !== "paid" ? "Private trip · not activated" : !row.feeRecordedAt ? "Fee expense not recorded" : row.expenseId ? `Fee expense: ${money(row.expenseAmountCents!)} · ${row.expenseBalanceMode === "tracking_only" ? "not allocated" : "allocated"}` : "Fee expense removed by the organizer"}</span>
            {row.refundHoldOpen ? <p>Refund before anyone was invited. Inviting is on hold until a person resolves it.</p> : null}
            {row.refundHoldResolved ? <span>Refund hold resolved.</span> : null}
            {row.reconciliationNeeded ? <p>Refund after people were invited. Everyone keeps access. Check the ledger: matching amounts alone don’t confirm reimbursements were corrected.</p> : null}
            {row.ledgerClosedAt ? <span>Ledger closed · the organizer must reopen it before corrections</span> : null}
          </div>
          <div className="setup-actions setup-actions--single">
            {row.status === "paid" && row.tripId && !row.feeRecordedAt ? <form action={retryFeeExpense}><input type="hidden" name="draftId" value={row.draftId} /><button className="secondary" type="submit">Retry fee expense</button></form> : null}
            {row.refundHoldOpen ? <form action={resolveRefundHold}><input type="hidden" name="draftId" value={row.draftId} /><label className="field"><span>Why inviting can continue</span><input name="reason" required maxLength={500} /></label><button className="secondary" type="submit">Resolve hold</button></form> : null}
            {row.paymentIntentId && /^pi_[a-zA-Z0-9_]+$/.test(row.paymentIntentId) ? <a className="button-secondary" href={`https://dashboard.stripe.com/test/payments/${row.paymentIntentId}`} target="_blank" rel="noreferrer">Provider test payment ↗</a> : null}
          </div>
        </article>) : <p className="operator-empty">No payment records on this page.</p>}
      </section>
      <nav className="setup-actions" aria-label="Payment pages">
        {page > 0 ? <Link className="button-secondary" href={`/admin/payments?page=${page - 1}`}>Newer payments</Link> : null}
        {payments.hasMore ? <Link className="button-secondary" href={`/admin/payments?page=${page + 1}`}>Older payments</Link> : null}
      </nav>
    </div>
  </main>;
}
