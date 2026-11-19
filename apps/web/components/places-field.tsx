"use client";

import { useId, useRef, useState } from "react";

/** The final line is the editable entry; earlier lines are committed places. */
export function PlacesField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const id = useId();
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  const lines = value.split("\n");
  const places = lines.slice(0, -1).filter(Boolean);
  const draft = lines.at(-1) ?? "";
  const update = (next: string[], text: string) => {
    if (next.length > 12 || next.some(place => place.length > 160)) {
      setError("Up to 12 places, 160 characters each.");
      return;
    }
    setError("");
    onChange([...next, text].join("\n"));
  };
  return <div className="field places-field">
    <label htmlFor={id}>Places <small>Optional</small></label>
    <div className="places-field-items">
      {places.map((place, index) => <span className="place-chip" key={`${index}-${place}`}>
        <span>{place}</span><button type="button" aria-label={`Remove ${place}`} onClick={() => {
          update(places.filter((_, i) => i !== index), draft);
          input.current?.focus();
        }}>×</button>
      </span>)}
    </div>
    <input ref={input} id={id} value={draft} maxLength={160} aria-describedby={`${id}-help`} placeholder="Add a city, state, province or country" onChange={event => update(places, event.target.value)} onKeyDown={event => {
      if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (draft.trim()) update([...places, draft.trim()], "");
    }} onPaste={event => {
      const text = event.clipboardData.getData("text");
      if (!/[\r\n]/.test(text)) return;
      event.preventDefault();
      const start = event.currentTarget.selectionStart ?? draft.length;
      const end = event.currentTarget.selectionEnd ?? start;
      const entries = (draft.slice(0, start) + text + draft.slice(end)).split(/\r?\n/).map(part => part.trim()).filter(Boolean);
      update([...places, ...entries], "");
    }} />
    {error ? <p className="form-error" role="alert">{error}</p> : null}
    <small id={`${id}-help`}>Press Enter to add each place. Use × to remove it.</small>
  </div>;
}
