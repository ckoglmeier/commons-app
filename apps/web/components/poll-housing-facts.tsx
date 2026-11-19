import { formatEstimate, type PollOption } from "@commons/contracts";

export function PollHousingFacts({ housing, compact = false }: { housing: NonNullable<PollOption["housing"]>; compact?: boolean }) {
  const total = housing.totalCents === null ? null : new Intl.NumberFormat("en-US", { style: "currency", currency: housing.currency }).format(housing.totalCents / 100);
  const details = <dl className="poll-housing-facts">
    <div><dt>Basis</dt><dd>{housing.nights} nights · {housing.people} people</dd></div>
    <div><dt>Rooms</dt><dd>{housing.rooms}</dd></div>
    <div><dt>{housing.stage === "illustrative" ? "Illustration" : "Supplied quote"}</dt><dd>{total ?? "Price unknown"}{housing.checkedOn ? ` · checked ${housing.checkedOn}` : ""}</dd></div>
    <div><dt>Fees</dt><dd>{housing.fees === "included" ? "Included in supplied total" : housing.fees === "excluded" ? "Extra · final total unknown" : "Unknown"}</dd></div>
    <div><dt>Cancellation</dt><dd>{housing.cancellation || "Unknown · check before booking"}</dd></div>
  </dl>;
  if (!compact) return details;
  return <div className="poll-housing-summary">
    <p>{housing.stage === "illustrative" ? "Illustrative concept · Price unknown" : `Supplied quote · ${total ?? "Price unknown"}`}</p>
    <p>{housing.nights} nights · {housing.people} people · {housing.fees === "included" ? "Fees included" : "Final total unknown"}</p>
    <details className="fieldnotes-context"><summary>Rooms, quote and terms</summary>{details}</details>
  </div>;
}

/** What an organizer was told about a supplied place. Always labeled an estimate or unknown, never a quote or availability. */
export function PollPropertyFacts({ property }: { property: NonNullable<PollOption["property"]> }) {
  return <dl className="poll-housing-facts">
    <div><dt>Rooms</dt><dd>{property.rooms}</dd></div>
    <div><dt>Beds</dt><dd>{property.beds === "king_only" ? "King beds only" : property.beds === "separate_beds_available" ? "Separate beds available" : "Not listed"}</dd></div>
    <div><dt>Price</dt><dd>{formatEstimate(property.pricing)}</dd></div>
  </dl>;
}
