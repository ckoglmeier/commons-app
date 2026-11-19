import { clockTime } from "@/lib/clock-time";
import type { CommonsParticipant, TravelPlan } from "@commons/contracts";

export function TravelArrangements({ plans, people, actorId, edit }: { plans: TravelPlan[]; people: CommonsParticipant[]; actorId: string; edit?: (kind: TravelPlan["kind"], id: string) => void }) {
  const visible = [...new Map(plans.filter(plan => plan.visibility !== "private" || plan.personId === actorId || (plan.personIds ?? [plan.personId]).includes(actorId)).map(plan => [plan.id, plan])).values()];
  const names = (ids: string[]) => ids.map(id => { const person = people.find(person => person.id === id); return person ? `${person.displayName}${person.membershipStatus === "invited" ? " (invited)" : ""}` : null; }).filter(Boolean).join(", ");
  const withoutSharedTravel = people.filter(person => person.membershipStatus === "active" && !visible.some(plan => plan.visibility !== "private" && (plan.kind === "arrival" || plan.kind === "departure") && (plan.personIds ?? [plan.personId]).includes(person.id)));
  return <section className="event-logistics-section">
    <h3>Travel arrangements</h3>
    {(["arrival", "departure", "car_rental", "transport"] as const).filter(kind => visible.some(plan => plan.kind === kind)).map(kind => <section key={kind} className="person-travel-leg">
      <h4>{kind === "arrival" ? "Getting there" : kind === "departure" ? "Heading home" : kind === "transport" ? "Transport" : "Rental cars"}</h4>
      {visible.filter(plan => plan.kind === kind).map(plan => <div className="event-stay-record" key={plan.id}>
        <details className="person-travel-record"><summary>
        <strong>{plan.provider ? `${plan.provider} · ` : ""}{plan.route}</strong>
        <p>{plan.date} · {clockTime(plan.time)}{plan.returnDate ? ` → ${plan.returnDate}` : ""}</p>
        <p>{names(plan.personIds ?? [plan.personId])}</p>
        <small>{plan.status === "considering" ? "Tentative · " : plan.status === "booked" ? "Booked · " : plan.status === "confirmed" ? "Confirmed · " : ""}{plan.visibility === "private" ? "Private · owner and included travelers" : "Shared arrangement"}</small>
        </summary><div className="person-travel-evidence">
        {plan.status ? <p>{plan.status}</p> : null}
        {plan.returnTime ? <p>Return time: {clockTime(plan.returnTime)}</p> : null}
        {plan.vehicle ? <p>{plan.vehicle}</p> : null}
        {plan.connections?.map((flight, index) => <p key={index}>{flight.flightNumber} · {flight.origin} → {flight.destination}<br />Departs {flight.departureDate} {clockTime(flight.departureTime)} {flight.departureTimezone}<br />Arrives {flight.arrivalDate} {clockTime(flight.arrivalTime)} {flight.arrivalTimezone}</p>)}
        {(plan.personId === actorId || (plan.personIds ?? [plan.personId]).includes(actorId) || plan.visibility === "all") ? <>{plan.note ? <p>{plan.note}</p> : null}{(plan.kind === "car_rental" || plan.kind === "transport") && plan.totalCents != null ? <p>{new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency ?? "USD" }).format(plan.totalCents / 100)}</p> : null}</> : null}
        {(plan.personId === actorId || (plan.personIds ?? [plan.personId]).includes(actorId)) && plan.confirmationCode ? <p>Confirmation: {plan.confirmationCode}</p> : null}
        {plan.personId === actorId && plan.confirmationDocumentUrl ? <a href={plan.confirmationDocumentUrl} target="_blank" rel="noreferrer">Open original confirmation</a> : null}
        <p>{plan.sourceLabel}</p>
        {plan.personId === actorId && edit ? <button type="button" className="travel-add-another" onClick={() => edit(kind, plan.id)}>Edit or share {kind === "car_rental" ? "rental" : kind}</button> : null}
        </div></details>
      </div>)}
    </section>)}
    {withoutSharedTravel.length ? <p>No shared getting-there or heading-home arrangement: {names(withoutSharedTravel.map(person => person.id))}. This does not mean they have not booked.</p> : null}
  </section>;
}
