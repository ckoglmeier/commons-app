"use client";
import { useId } from "react";
import type { LodgingPreparation } from "@commons/contracts";
import { CoordinatorMark } from "@commons/ui";

/*
 * What Commons did after a reviewed lodging update was applied. It is Commons activity beneath the saved receipt, attributed to the organizer whose apply
 * caused it, and never shown as a message that organizer typed. Preparation only: nothing is booked, held, paid for or sent. Synthetic fixture evidence is
 * labeled wherever it appears and is never offered as a link to a real source.
 */
const money = (cents: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(cents / 100);

const UNAVAILABLE = {
  not_enabled: "the booking-brief follow-up is turned off for this trip",
  edited_in_review: "the stay was changed in review from the option Commons prepared",
  stay_missing: "Commons couldn’t find the saved stay",
} as const;

export function LodgingFollowUp({ preparation, appliedBy, focusRef }: { preparation: LodgingPreparation; appliedBy: string; focusRef?: (node: HTMLElement | null) => void }) {
  const headingId = useId();
  const outcome = preparation.outcome;
  if (!outcome) return null;
  const label = <p className="review-coordinator"><CoordinatorMark aria-hidden="true" /> Commons activity</p>;
  if (outcome.status === "unavailable") return <section className="workspace-follow-up" aria-labelledby={headingId} tabIndex={-1} ref={focusRef}>
    {label}
    <h3 id={headingId}>No booking brief prepared</h3>
    <p>{appliedBy} saved the stay. Commons didn’t prepare a booking brief because {UNAVAILABLE[outcome.reason]}. Nothing was booked.</p>
  </section>;
  const { brief } = outcome, option = brief.selectedOption, approval = brief.approvalBasis;
  return <section className="workspace-follow-up" aria-labelledby={headingId} tabIndex={-1} ref={focusRef}>
    {label}
    <h3 id={headingId}>Booking brief: {option.name}</h3>
    <p className="review-caption">Prepared by Commons after {approval.approvedByName} applied this update · Preparation only</p>
    {outcome.staleSinceApproval ? <p className="workspace-follow-up-stale"><strong>Out of date.</strong> The saved stay changed after {approval.approvedByName} approved it. Commons won’t update this brief under that approval; ask for a fresh shortlist to prepare a new one.</p> : null}
    <p>{brief.statement}</p>
    <ul className="workspace-trip-receipt">
      <li>{option.address} · {option.startsOn} to {option.endsOn}</li>
      <li>{money(option.totalCents)} reported cost{option.synthetic ? " · from synthetic fixture evidence, not a real price" : ""}</li>
      <li>Travelers: {brief.travelers.map(person => person.name).join(", ") || "None selected"}</li>
      {brief.constraintsApplied.length ? <li>Shared constraints used: {brief.constraintsApplied.join("; ")}</li> : null}
      <li>Approved by {approval.approvedByName} · review version {approval.version}</li>
    </ul>
    <h4>Still open</h4>
    <ul className="workspace-trip-receipt">{brief.missingInformation.map(item => <li key={item}>{item}</li>)}</ul>
    {option.synthetic ? <p className="review-caption">Evidence: synthetic fixture listing. There is no real supplier page to open.</p>
      : option.evidenceUrls.length ? <div className="workspace-actions">{option.evidenceUrls.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer">Source{option.evidenceUrls.length > 1 ? ` ${index + 1}` : ""}</a>)}</div> : null}
  </section>;
}
