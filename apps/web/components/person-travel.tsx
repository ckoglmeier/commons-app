"use client";
import { clockTime } from "@/lib/clock-time";

import type { ReactNode } from "react";
import type { CommonsParticipant, TravelPlan } from "@commons/contracts";
import { visibleTravelForPerson } from "@/lib/event-logistics";

function dateLabel(date: string, time?: string | null) {
  const day = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
  if (!time) return `${day} · Time not added`;
  const [hour, minute] = time.split(":").map(Number);
  return `${day} · ${hour % 12 || 12}:${String(minute).padStart(2, "0")} ${hour >= 12 ? "PM" : "AM"}`;
}

export function PersonTravel({ personId, actorId, participants, plans, editor, edit, showEmpty }: {
  personId: string; actorId: string; participants: CommonsParticipant[]; plans: TravelPlan[];
  editor?: ReactNode; edit: (kind: TravelPlan["kind"], id?: string) => void; showEmpty: boolean;
}) {
  const visible = visibleTravelForPerson(plans, personId, actorId);
  return <div className="person-travel">
    {(["arrival", "departure", "car_rental", "transport"] as const).map(kind => {
      const records = visible.filter(plan => plan.kind === kind);
      if (!records.length && (kind === "car_rental" || !showEmpty)) return null;
      return <div className="person-travel-leg" key={kind}>
        <h4>{kind === "arrival" ? "Getting there" : kind === "departure" ? "Heading home" : kind === "transport" ? "Transport" : "Rental cars"}</h4>
        {!records.length ? <p className="event-logistics-note">No shared plan</p> : records.map(plan => {
          const owned = plan.personId === actorId;
          const included = plan.personIds ?? [plan.personId];
          const canViewPrivate = owned || included.includes(actorId);
          const canViewCost = canViewPrivate || plan.visibility === "all";
          return <details className="person-travel-record" key={plan.id}>
            <summary><strong>{plan.provider ? `${plan.provider} · ` : ""}{plan.vehicle ? `${plan.vehicle} · ` : ""}{plan.route}</strong>
              <span>{kind === "arrival" ? "Arrives " : kind === "departure" ? "Departs " : "Pick-up "}{dateLabel(plan.date, plan.time)}</span>
              {plan.returnDate ? <span>Return {dateLabel(plan.returnDate, plan.returnTime)}</span> : null}
              <small>{plan.visibility === "private" ? "Private · owner and included travelers" : plan.visibility === "all" ? "Shared including cost" : "Basic details shared"}</small>
            </summary>
            <div className="person-travel-evidence">
            {included.length > 1 || !included.includes(personId) ? <small>{included.includes(personId) ? "With " : "For "}{included.filter(id => id !== personId).map(id => participants.find(person => person.id === id)?.displayName).filter(Boolean).join(", ")}</small> : null}
              {plan.status ? <p>{plan.status === "considering" ? "Considering" : plan.status === "booked" ? "Booked" : "Confirmed"}</p> : null}
              {plan.connections?.map((flight, index) => <div key={index}><strong>{flight.flightNumber || `Flight ${index + 1}`} · {flight.origin || "From not added"} → {flight.destination || "To not added"}</strong><p>Departs {flight.departureDate || "Date not added"} · {clockTime(flight.departureTime)} {flight.departureTimezone ?? ""}</p><p>Arrives {flight.arrivalDate || "Date not added"} · {clockTime(flight.arrivalTime)} {flight.arrivalTimezone ?? ""}</p></div>)}
              {canViewCost && plan.note ? <p>{plan.note}</p> : null}
              {(kind === "car_rental" || kind === "transport") && canViewCost && plan.totalCents != null ? <p>Booking total: {new Intl.NumberFormat("en-US", { style: "currency", currency: plan.currency ?? "USD" }).format(plan.totalCents / 100)}</p> : null}
              {canViewPrivate && plan.confirmationCode ? <p>Confirmation: {plan.confirmationCode}</p> : null}
              {owned && plan.confirmationDocumentUrl ? <a href={plan.confirmationDocumentUrl} target="_blank" rel="noreferrer">Open original confirmation</a> : null}
              <p className="event-logistics-note">{plan.sourceLabel}</p>
            {owned ? <button type="button" className="travel-add-another" onClick={() => edit(kind, plan.id)}>Edit or share {kind === "arrival" ? "arrival" : kind === "departure" ? "departure" : "rental"}</button> : null}
            </div>
          </details>;
        })}
      </div>;
    })}
    {editor}
  </div>;
}
