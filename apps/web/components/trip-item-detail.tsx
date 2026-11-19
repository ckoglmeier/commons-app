"use client";
import { clockTime } from "@/lib/clock-time";
import type { CommonsState, CommonsSummary, Stay } from "@commons/contracts";
import { formatDuration, itineraryDurationMinutes } from "@commons/contracts";
import { ModalLayer } from "./modal-layer";
import { CloseIcon } from "./icons";
import { MealTypeLine } from "./meal-fields";
import { PlanLocationLink } from "./plan-location-link";

/** One permissioned canonical record, opened from Plan, Money, or a reference link. */
export function TripItemDetail({ item, stay, commons, close, edit, addPhotos, viewPhotos, photoCount = 0, convertToExpense }: {
  item?: CommonsState["itinerary"][number]; stay?: Stay; commons: CommonsSummary; close: () => void;
  edit?: () => void; addPhotos?: () => void; viewPhotos?: () => void; photoCount?: number; convertToExpense?: () => void;
}) {
  const title = item?.title ?? stay?.name ?? "Item unavailable";
  const when = item?.startsAt ? new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(item.startsAt)) : item?.scheduledDate ? `${item.scheduledDate} · Time not set` : stay ? `${stay.startsOn} – ${stay.endsOn}` : "No day set";
  const duration = item ? itineraryDurationMinutes(item) : null;
  const location = item?.location ?? stay?.address;
  return <ModalLayer close={close}><section className="sheet trip-item-detail" role="dialog" aria-modal="true" aria-labelledby="trip-item-title">
    <header className="sheet-header"><h2 id="trip-item-title">{title}</h2><button type="button" aria-label="Close item details" onClick={close}><CloseIcon /></button></header>
    <p className="sheet-summary">{when}{duration !== null ? ` · ${formatDuration(duration)}` : ""}</p>
    <MealTypeLine type={item?.mealType} />
    {location ? <p><PlanLocationLink location={location} /></p> : null}
    {stay ? <p>{stay.status === "confirmed" ? "Confirmed, as reported" : "Planned"}{stay.checkInTime ? ` · Check-in ${clockTime(stay.checkInTime)}` : ""}{stay.checkOutTime ? ` · Check-out ${clockTime(stay.checkOutTime)}` : ""}</p> : null}
    {stay?.totalCents != null ? <p>{new Intl.NumberFormat("en-US", {style:"currency", currency:stay.currency ?? "USD"}).format(stay.totalCents / 100)} · {stay.costSource === "confirmation" ? "From confirmation" : stay.costSource === "expense" ? "Recorded cost" : "Planning cost"}</p> : null}
    {item ? <p>{item.status === "confirmed" ? "Confirmed, as reported" : item.status === "cancelled" ? "Cancelled" : item.status === "idea" ? "Idea" : "Planned"}</p> : null}
    {item?.note || stay?.details ? <p>{item?.note ?? stay?.details}</p> : null}
    {item?.mealReservation ? <section aria-label="Your reservation"><h3>Your reservation · private</h3>{item.mealReservation.number ? <p>Confirmation: {item.mealReservation.number}</p> : null}{item.mealReservation.note ? <p>{item.mealReservation.note}</p> : null}</section> : null}
    <p className="sheet-footnote">{item?.provenanceLabel ?? stay?.sourceLabel}</p>
    <div className="trip-item-actions">{convertToExpense ? <button className="sheet-secondary" type="button" onClick={convertToExpense}>{item?.mealType ? "Add cost" : "Convert to expense"}</button> : null}{edit ? <button className="sheet-secondary" type="button" onClick={edit}>Edit details</button> : null}{addPhotos ? <button className="sheet-secondary" type="button" onClick={addPhotos}>Add photos</button> : null}{photoCount && viewPhotos ? <button className="sheet-secondary" type="button" onClick={viewPhotos}>View {photoCount} {photoCount === 1 ? "photo" : "photos"}</button> : null}</div>
  </section></ModalLayer>;
}
