"use client";
import { useId } from "react";
import type { MealType } from "@commons/contracts";

export function MealTypeField({ value, onChange, disabled = false }: { disabled?: boolean; value: MealType; onChange: (value: MealType) => void }) {
  const id = useId();
  return <fieldset className="plan-timing-choice" disabled={disabled}><legend>Meal type</legend><div>
    <label htmlFor={`${id}-restaurant`}><input id={`${id}-restaurant`} type="radio" name={id} value="restaurant" checked={value === "restaurant"} onChange={() => onChange("restaurant")} /><span>Restaurant</span></label>
    <label htmlFor={`${id}-home`}><input id={`${id}-home`} type="radio" name={id} value="home" checked={value === "home"} onChange={() => onChange("home")} /><span>Meal at home</span></label>
  </div></fieldset>;
}

export function MealTypeLine({ type }: { type?: MealType | null }) {
  return type ? <p className="plan-item-note">{type === "home" ? "Meal at home" : "Restaurant meal"}</p> : null;
}

export function MealReservationFields({ number, note, setNumber, setNote }: { number: string; note: string; setNumber: (value: string) => void; setNote: (value: string) => void }) {
  return <section className="meal-reservation-fields" aria-label="Your reservation">
    <p className="meal-reservation-fields__privacy">Only you can see these reservation details.</p>
    <label className="field"><span>Reservation confirmation number <small>Optional</small></span><input value={number} onChange={event => setNumber(event.target.value)} maxLength={120} autoComplete="off" /></label>
    <label className="field"><span>Private reservation notes <small>Optional</small></span><textarea value={note} onChange={event => setNote(event.target.value)} maxLength={1000} rows={3} placeholder="Name on the reservation, party size or special instructions" /></label>
  </section>;
}
