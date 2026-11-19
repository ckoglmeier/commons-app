import Link from "next/link";
import { formatTransferWindow, formatTripDateRange, type RecipeContext, type TransportProposal } from "@commons/contracts";
import { formatDay } from "@/lib/recipe-client";

type Review = { tripName: string; tripTimezone: string; travelers: number; flights: number; proposal: TransportProposal; context?: RecipeContext };
const word = (direction: "arrival" | "departure") => direction === "arrival" ? "Arriving" : "Leaving";

/** Suggestions from flights people already shared with the trip. Read-only: nothing is saved, assigned, booked or sent. */
export function RecipeTransport({ slug, review }: { slug: string; review: Review }) {
  const { proposal } = review, windows = [30, 60, 90, 120];
  return <article aria-labelledby="transport-title">
    <div className="poll-organizer-intro poll-page-heading"><div><span className="view-kicker">Coordinate transport · Suggestions</span><h1 id="transport-title">Suggested rides</h1></div></div>
    <p className="recipe-lede">Built from the {review.flights} flight {review.flights === 1 ? "leg" : "legs"} people have already added to the trip. These are suggestions to review. Nothing is saved, no one is assigned, and no one is told.</p>
    {review.context?.sources.some(source => source.reconsidering) ? <p className="recipe-attention">An earlier approved result is being reconsidered. Attendance from that result is provisional for these suggestions.</p> : null}
    {review.context ? <details className="fieldnotes-context"><summary>Saved planning context</summary><p>{review.context.trip.startsOn && review.context.trip.endsOn ? formatTripDateRange(review.context.trip.startsOn, review.context.trip.endsOn) : "Dates still open"} · {review.context.trip.locationNames.join(", ") || "Location still open"}</p>
      {review.context.sources.map(source => <div key={source.outcomeId}><Link href={`/c/${encodeURIComponent(slug)}/recipes/${source.runId}`}>{source.kind === "attendance" ? "Recorded attendance" : "Dates and location decision"}</Link>{source.reconsidering ? <p className="recipe-attention">An earlier approved result is being reconsidered. Attendance from that result is provisional for these suggestions.</p> : null}{source.stale.map((reason, index) => <p className="recipe-attention" key={index}>{reason}</p>)}{source.conditions.map((condition, index) => <p key={index}>Still to account for: {condition}</p>)}</div>)}
      <p className="recipe-note">Attendance for changed dates is provisional until reviewed again.</p></details> : null}
    <nav className="recipe-windows" aria-label="Grouping window"><span>People who land or leave within</span>{windows.map(minutes => <Link key={minutes} className="cm-action" aria-current={proposal.windowMinutes === minutes ? "true" : undefined} href={`/c/${encodeURIComponent(slug)}/recipes/transport?window=${minutes}`}>{minutes} min</Link>)}<span>of each other</span></nav>
    {(["arrival", "departure"] as const).map(direction => { const groups = proposal.groups.filter(group => group.direction === direction); return <section className="recipe-section" key={direction} aria-labelledby={`rides-${direction}`}>
      <h2 id={`rides-${direction}`}>{direction === "arrival" ? "Getting there" : "Getting home"}</h2>
      {groups.length ? <ul className="recipe-options">{groups.map(group => <li key={group.id}>
        <strong>{word(direction)} {group.place} · {formatTransferWindow(group)}</strong>
        <p className="recipe-fact">{[group.confirmedCount ? `${group.confirmedCount} confirmed` : "", group.provisionalCount ? `${group.provisionalCount} not yet confirmed` : ""].filter(Boolean).join(" and ")}: {group.members.map(member => `${member.name}${member.provisional ? " (not yet confirmed)" : ""} ${formatTime(member.time)}`).join(", ")}</p>
        {group.dates.length > 1 ? <p>On {group.dates.map(formatDay).join(" and ")}.</p> : <p>{formatDay(group.dates[0])}.</p>}
        {group.assumedTimezone ? <p className="recipe-attention">A flight here didn’t give a usable time zone, so the trip’s ({review.tripTimezone}) is assumed. Check it.</p> : null}
        <p className="recipe-note">The latest landing or departure is {formatTime(group.endLocal)}. Pick the pickup time yourself.</p></li>)}</ul>
        : <p className="recipe-note">No one {direction === "arrival" ? "lands" : "leaves"} close enough together at the same place to suggest a shared ride.</p>}
    </section>; })}
    {proposal.places.length ? <section className="recipe-section" aria-labelledby="rides-places"><h2 id="rides-places">Where everyone is flying</h2>
      <ul className="recipe-history">{proposal.places.map(item => <li key={`${item.direction}-${item.place}`}>{word(item.direction)} {item.place}: {item.names.join(", ")}</li>)}</ul>
      {new Set(proposal.places.filter(item => item.direction === "arrival").map(item => item.place.toLocaleUpperCase())).size > 1 ? <p className="recipe-note">People arrive at different airports. They aren’t combined, so work out whether a shared ride makes sense for those.</p> : null}</section> : null}
    {proposal.needsDetails.length || proposal.noFlight.length ? <section className="recipe-section" aria-labelledby="rides-missing"><h2 id="rides-missing">Details still missing</h2>
      {proposal.needsDetails.length ? <><h3>Flights that can’t be placed</h3><ul className="recipe-history">{proposal.needsDetails.map(item => <li key={`${item.personId}-${item.direction}`}>{item.name} ({item.direction}): missing {item.missing.join(" and ")}</li>)}</ul></> : null}
      {proposal.noFlight.length ? <><h3>No flight added yet</h3><ul className="recipe-history">{proposal.noFlight.map(item => <li key={`${item.personId}-${item.direction}`}>{item.name}: {item.direction === "arrival" ? "getting there" : "getting home"}</li>)}</ul>
        <p className="recipe-note">People add their own flights in Plan. Someone driving, or booking later, will show here too. Nothing is asked of them from this page.</p></> : null}</section> : null}
    <details className="recipe-secondary-actions"><summary>How these were worked out</summary><ul className="recipe-history">{proposal.assumptions.map(item => <li key={item}>{item}</li>)}</ul>
      <p className="recipe-note">Only the route, date and time people shared with the whole trip are used. Costs, notes and confirmation numbers are never read.</p></details>
  </article>;
}
function formatTime(value: string) { const [hour, minute] = value.split(":").map(Number); return `${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour < 12 ? "AM" : "PM"}`; }
