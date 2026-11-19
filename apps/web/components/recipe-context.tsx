import Link from "next/link";
import { formatTripDateRange, type RecipeRunDetail } from "@commons/contracts";

/** Organizer-only projection. Never reuse this renderer for a participant poll. */
export function RecipeContextView({ slug, run }: { slug: string; run: RecipeRunDetail }) {
  if (!run.context) return null;
  const { saved, current, changed } = run.context, context = saved ?? current;
  const reconsidering = (source: typeof context.sources[number]) => source.reconsidering || current.sources.some(latest => latest.outcomeId === source.outcomeId && latest.reconsidering);
  const dates = (trip: typeof context.trip) => trip.startsOn && trip.endsOn ? formatTripDateRange(trip.startsOn, trip.endsOn) : "Dates still to decide";
  return <section className="recipe-section" aria-labelledby="recipe-context-title">
    <h2 id="recipe-context-title">Carried forward</h2>
    <p>{dates(context.trip)} · {context.trip.locationNames.join(", ") || "Location still to decide"}</p>
    {context.attendance ? <p>{context.sources.some(source => source.kind === "attendance" && reconsidering(source)) ? "Earlier approved attendance: " : ""}{context.attendance.in} recorded in · {context.attendance.maybe} maybe. {context.attendance.people.filter(person => person.state === "unanswered").length} without an attendance answer.</p> : <p className="recipe-note">No approved attendance result yet. Party size is still open.</p>}
    {context.sources.map(source => <div key={source.outcomeId}>
      <p className="recipe-note"><Link href={`/c/${encodeURIComponent(slug)}/recipes/${source.runId}`}>{source.kind === "dates_location" ? "Dates and location decision" : "Attendance decision"}</Link> · approved by {source.approvedByName}{source.status === "approved" && source.kind === "dates_location" ? " · not applied to the trip" : ""}</p>
      {reconsidering(source) ? <p className="recipe-attention">This earlier approved result is being reconsidered in a new round. It has not been replaced.</p> : null}
      {source.conditions.length ? <ul>{source.conditions.map((condition, index) => <li key={index}>Still to account for: {condition}</li>)}</ul> : null}
      {source.needs.map((need, index) => <p key={index}>{need.name}: {need.text}{need.resolution ? <> · Organizer’s handling: {need.resolution}</> : " · No handling recorded"}</p>)}
      {source.stale.map((reason, index) => <p className="recipe-attention" key={index}>{reason}</p>)}
    </div>)}
    {changed ? <div className="recipe-attention" role="status"><strong>Saved context changed.</strong><p>Now: {dates(current.trip)} · {current.trip.locationNames.join(", ") || "Location still to decide"}{current.attendance ? ` · ${current.attendance.in} recorded in and ${current.attendance.maybe} maybe` : " · Attendance still open"}.</p><p>{run.stage === "draft" ? "Review the new details and introduction before saving and sharing this draft." : "This round keeps the context it was shared with. Review a private follow-up before asking again."}</p></div> : null}
    <p className="recipe-note">These planning notes stay with organizers. Only the poll introduction and questions below are shared.</p>
  </section>;
}
