"use client";
import { clockTime } from "@/lib/clock-time";


import type { CommonsParticipant, CommonsSummary, Stay, TravelPlan } from "@commons/contracts";
import type { ReactNode } from "react";
import { TravelArrangements } from "./travel-arrangements";
import { eventLogisticsModel } from "@/lib/event-logistics";
import { PeopleResults } from "./people-results";
import { EventAttendancePanel } from "./event-attendance";
import { LogisticsAddMenu } from "./logistics-add-menu";
import { StayAddressActions } from "./stay-address-actions";

function dates(start: string | null, end: string | null) {
  const format = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
  if (!start && !end) return "Not set";
  if (!start) return `Ends ${format(end!)}`;
  return end && end !== start ? `${format(start)} – ${format(end)}` : format(start);
}

export function EventLogisticsView({ commons, participants, stays, travelPlans, currentActorId, persistent, canManage, canEditBasics = canManage, canEditStays = canManage, editBasics, peopleRevision = 0, basicsEditor, stayEditor, editingStayId, showStays = true, addThing, addMeal, addStay, editStay, openStay, addTravel, editTravel, copyAddress, editorOpen = false }: {
  commons: CommonsSummary; participants: CommonsParticipant[]; stays: Stay[]; travelPlans: TravelPlan[];
  currentActorId: string; persistent: boolean; canManage: boolean; canEditBasics?: boolean; canEditStays?: boolean;
  editBasics: () => void; peopleRevision?: number; basicsEditor?: ReactNode; stayEditor?: ReactNode; editingStayId?: string | null; showStays?: boolean;
  openStay?: (id: string) => void;
  addThing: () => void; addMeal: () => void; addStay: () => void; editStay: (id: string) => void;
  addTravel: (kind: "flight" | "transport") => void; editorOpen?: boolean;
  editTravel?: (kind: TravelPlan["kind"], id: string) => void;
  copyAddress: (address: string) => void | Promise<void>;
}) {
  const model = eventLogisticsModel(commons, stays, travelPlans, participants, currentActorId);
  return <div className="product-view event-logistics-view">
    <div className="view-intro event-logistics-intro event-page-header"><div><h2>Plan</h2><p>{showStays ? "Travel & stays" : "Travel"}</p></div><LogisticsAddMenu canAddStay={canEditStays} disabled={editorOpen} choose={kind => kind === "stay" ? addStay() : kind === "thing" ? addThing() : kind === "meal" ? addMeal() : addTravel(kind)} /></div>
    <div className="event-logistics-layout">
      <aside className="event-logistics-side">
        <section className="event-logistics-section" aria-labelledby="event-basics-title">
          <div className="event-logistics-heading"><h3 id="event-basics-title">Dates and places</h3>{canEditBasics ? <button className="cm-action" type="button" onClick={editBasics} aria-label="Edit dates and places">{!commons.startsOn && !commons.endsOn && !model.places.length ? "Add details" : "Edit"}</button> : null}</div>
          {!canEditBasics ? <p className="event-logistics-note">Viewing as {participants.find(person => person.id === currentActorId)?.displayName ?? "a participant"}. Only organizers can edit dates, places, and stays.</p> : null}
          {basicsEditor ?? <dl className="event-basics-list"><div><dt>Dates</dt><dd>{dates(commons.startsOn, commons.endsOn)}</dd></div><div><dt>Places</dt><dd>{model.places.length ? model.places.join(" · ") : "Not set"}</dd></div><div><dt>Timezone</dt><dd>{commons.timezone.replaceAll("_", " ")}</dd></div></dl>}
        </section>
        {showStays && (model.stays.length || model.legacyStay || stayEditor) ? <section className="event-logistics-section" aria-labelledby="event-stays-title">
          <div className="event-logistics-heading"><h3 id="event-stays-title">{model.stays.length > 1 ? "Stays" : "Stay"}</h3></div>
          {model.stays.map(stay => <div className="event-stay-record" key={stay.id}>
            <div className="event-stay-heading">
              <details className="event-stay-details">
                <summary><span><strong>{stay.name}</strong><small>{dates(stay.startsOn, stay.endsOn)} · {stay.status === "confirmed" ? "Confirmed" : "Planned"}</small></span></summary>
            <div className="event-stay-content"><p>{stay.includedPersonIds.map(id => participants.find(person => person.id === id)?.displayName).filter(Boolean).join(", ")}</p>
              {stay.checkInTime || stay.checkOutTime ? <p>{stay.checkInTime ? `Check-in ${clockTime(stay.checkInTime)}` : ""}{stay.checkInTime && stay.checkOutTime ? " · " : ""}{stay.checkOutTime ? `Check-out ${clockTime(stay.checkOutTime)}` : ""}</p> : null}
              {stay.totalCents != null ? <p>{new Intl.NumberFormat("en-US", { style: "currency", currency: stay.currency ?? "USD" }).format(stay.totalCents / 100)} · {stay.costSource === "confirmation" ? "From confirmation" : stay.costSource === "expense" ? "Recorded cost" : "Planning cost"}</p> : null}
              {stay.details ? <p>{stay.details}</p> : null}
              <p className="event-logistics-note">{stay.sourceLabel}</p>
            </div>
              </details>
              {canEditStays ? <button className="event-stay-edit" type="button" onClick={() => editStay(stay.id)} aria-haspopup="dialog" aria-label={`Edit stay: ${stay.name}`}>Edit</button> : null}
            </div>
            {openStay ? <button type="button" className="text-action" onClick={() => openStay(stay.id)}>View stay details</button> : null}
            <p className="event-stay-address">{stay.address}</p>
            <StayAddressActions name={stay.name} address={stay.address} copy={copyAddress} />
            {editingStayId === stay.id && stayEditor ? stayEditor : null}
          </div>)}
          {!editingStayId ? stayEditor : null}
          {model.legacyStay ? <div className="event-stay-content"><strong>{model.legacyStay.name}</strong><p>{model.legacyStay.address}</p><StayAddressActions name={model.legacyStay.name} address={model.legacyStay.address} copy={copyAddress} /></div> : null}
        </section> : null}
      </aside>
      <div className="event-logistics-main">
        {travelPlans.length ? <TravelArrangements plans={travelPlans} people={participants} actorId={currentActorId} edit={editTravel} /> : null}
        {persistent ? <EventAttendancePanel key={`${commons.id}:${commons.startsOn}:${commons.endsOn}:${peopleRevision}`} eventId={commons.id} readOnly participants={participants} /> : <PeopleResults participants={participants} />}
      </div>
    </div>
  </div>;
}
