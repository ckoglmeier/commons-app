"use client";
import { useState } from "react";
import type { CommonsParticipant, CommonsSummary, TravelPlan } from "@commons/contracts";
import { clockTime } from "@/lib/clock-time";
import type { LogisticsAddKind } from "./logistics-add-menu";

const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${day}T12:00:00Z`));
const included = (plan: TravelPlan) => plan.personIds ?? [plan.personId];
export const travelOptionLabel = (plan: TravelPlan) => plan.provider ?? plan.vehicle ?? (plan.kind === "car_rental" ? "Rental car" : "Transport");

/** Plan → Travel: how each person gets there and home, and how the group gets
 * around. A missing arrival means nothing was shared, never that nothing is booked. */
export function TripTravelView({ commons, participants, travelPlans, actorId, canAskGroup, editorOpen, choose, editTravel }: {
  commons: CommonsSummary; participants: CommonsParticipant[]; travelPlans: TravelPlan[]; actorId: string; canAskGroup: boolean;
  editorOpen?: boolean; choose: (kind: LogisticsAddKind) => void; editTravel: (plan: TravelPlan) => void;
}) {
  const visible = [...new Map(travelPlans.filter(plan => plan.visibility !== "private" || plan.personId === actorId || included(plan).includes(actorId)).map(plan => [plan.id, plan])).values()];
  const name = (id: string) => participants.find(person => person.id === id)?.displayName ?? "Previous traveler";
  const active = participants.filter(person => person.membershipStatus === "active");
  const canSeeDetails = (plan: TravelPlan) => plan.visibility === "all" || plan.personId === actorId || included(plan).includes(actorId);
  const legs = (kind: "arrival" | "departure") => {
    const plans = visible.filter(plan => plan.kind === kind).sort((a, b) => a.date.localeCompare(b.date) || (a.time ?? "99").localeCompare(b.time ?? "99"));
    return [...new Set(plans.map(plan => plan.date))].map(day => ({ day, plans: plans.filter(plan => plan.date === day) }));
  };
  const missing = (kind: "arrival" | "departure") => active.filter(person => !visible.some(plan => plan.kind === kind && included(plan).includes(person.id)));
  const around = visible.filter(plan => plan.kind === "transport" || plan.kind === "car_rental").sort((a, b) => a.date.localeCompare(b.date));
  const [left, setLeft] = useState<Set<string>>(() => new Set());
  const chosen = around.filter(plan => !left.has(plan.id));
  const choosing = canAskGroup && around.length >= 2;
  const pollPath = `/c/${commons.id}/polls/new?transportIds=${chosen.map(plan => plan.id).join(",")}`;

  return <div className="product-view trip-travel-view">
    {/* Travel & stays shows one shared header with the Add menu. */}
    <section className="event-logistics-section" aria-labelledby="trip-travel-there-title">
      <div className="event-logistics-heading"><h3 id="trip-travel-there-title">Getting there and home</h3>
        <button type="button" className="cm-action" disabled={editorOpen} onClick={() => choose("flight")}>Add your travel</button></div>
      {(["arrival", "departure"] as const).map(kind => {
        const days = legs(kind), notShared = missing(kind);
        return <div key={kind} className="trip-travel-leg">
          <h4>{kind === "arrival" ? "Arriving" : "Heading home"}</h4>
          {days.length ? days.map(({ day, plans }) => <div key={day} className="trip-travel-day">
            <p className="trip-travel-date">{dayLabel(day)}</p>
            <ul className="trip-stays-list">{plans.map(plan => <li key={plan.id}><div className="trip-stays-row">
              <span className="trip-stays-name"><strong>{plan.time ? clockTime(plan.time) : "Time not shared"} · {included(plan).map(name).join(", ")}</strong>
                <small>{[plan.provider, plan.route, plan.connections?.length ? plan.connections.map(flight => flight.flightNumber).filter(Boolean).join(", ") : null, plan.visibility === "private" ? "Private to the people on it" : null].filter(Boolean).join(" · ")}</small></span>
              {plan.personId === actorId ? <button type="button" className="cm-action cm-action--quiet" onClick={() => editTravel(plan)} aria-label={`Edit travel: ${plan.route}`}>Edit</button> : null}
            </div></li>)}</ul>
          </div>) : null}
          {notShared.length ? <p className="event-logistics-note">Not shared yet: {notShared.map(person => person.displayName).join(", ")}. That doesn’t mean they haven’t booked.</p>
            : !days.length ? <p className="event-logistics-note">No one has shared this yet.</p> : null}
        </div>;
      })}
    </section>
    <section className="event-logistics-section" aria-labelledby="trip-travel-around-title">
      <div className="event-logistics-heading"><h3 id="trip-travel-around-title">Getting around</h3>
        <button type="button" className="cm-action" disabled={editorOpen} onClick={() => choose("transport")}>Add an option</button></div>
      {around.length ? <ul className="trip-stays-list">{around.map(plan => <li key={plan.id}>
        <div className="trip-stays-row">
          <span className="trip-stays-name"><strong>{travelOptionLabel(plan)}</strong>
            <small>{[plan.status === "booked" ? "Booked" : plan.status === "confirmed" ? "Confirmed" : "Considering", plan.kind === "car_rental" ? "Rental car" : plan.vehicle,
              `${included(plan).length} ${included(plan).length === 1 ? "person" : "people"}`].filter(Boolean).join(" · ")}</small></span>
          {plan.personId === actorId ? <button type="button" className="cm-action cm-action--quiet" onClick={() => editTravel(plan)} aria-label={`Edit option: ${travelOptionLabel(plan)}`}>Edit</button> : null}
        </div>
        <dl className="trip-stays-compare">
          <div><dt>When</dt><dd>{dayLabel(plan.date)}{plan.time ? `, ${clockTime(plan.time)}` : ""}{plan.returnDate ? ` – ${dayLabel(plan.returnDate)}` : ""}</dd></div>
          <div><dt>Route</dt><dd>{plan.route}</dd></div>
          <div><dt>Price</dt><dd>{canSeeDetails(plan) && plan.totalCents != null ? new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency ?? "USD" }).format(plan.totalCents / 100) : canSeeDetails(plan) ? "Not added yet" : "Shared with the people on it"}</dd></div>
          <div><dt>Notes</dt><dd>{canSeeDetails(plan) && plan.note ? <span className="trip-stays-note-text">{plan.note}</span> : <span className="event-logistics-note">{canSeeDetails(plan) ? "No notes yet." : "Shared with the people on it"}</span>}</dd></div>
        </dl>
        {choosing ? <div className="trip-stays-footer"><span /><label className="trip-stays-include"><input type="checkbox" checked={!left.has(plan.id)}
          onChange={event => setLeft(current => { const next = new Set(current); if (event.target.checked) next.delete(plan.id); else next.add(plan.id); return next; })} /> Include in the poll</label></div> : null}
      </li>)}</ul>
        : <p className="event-logistics-note">Add the ways you’re considering, like a hired van, rental cars, or rideshares. Note seats and who can drive.</p>}
      {choosing ? <div className="trip-stays-actions">{chosen.length >= 2 ? <a className="cm-action cm-action--primary" href={pollPath}>Ask how we get around ({chosen.length})</a>
        : <span className="event-logistics-note">Include at least two options in the poll.</span>}</div> : null}
      {choosing ? <p className="event-logistics-note">This starts a private “How should we get around?” poll draft. Prices and notes are included only for options shared with everyone. You review it before sharing; nothing is booked.</p> : null}
    </section>
  </div>;
}
