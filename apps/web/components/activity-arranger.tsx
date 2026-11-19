"use client";

import type { CommonsParticipant, ItineraryItem } from "@commons/contracts";

export function ActivityArrangerLine({ item }: { item: ItineraryItem }) {
  if (!item.arrangerPersonId) return null;
  return <p className="plan-item-note">Being arranged by {item.arrangerName ?? "a participant"}{item.arrangerActive === false ? " · Needs reassignment" : ""}</p>;
}

export function ActivityArrangerField({ value, onChange, participants, previousName }: {
  value: string | null;
  onChange: (personId: string | null) => void;
  participants: CommonsParticipant[];
  previousName?: string;
}) {
  const eligible = participants.filter((person) => person.membershipStatus === "active" && person.accessMode !== "managed");
  const previousUnavailable = value && !eligible.some((person) => person.id === value);
  return <label className="field"><span>Who’s arranging this? <small>Optional</small></span>
      <select value={value ?? ""} onChange={(event) => onChange(event.target.value || null)}>
        <option value="">Unassigned</option>
        {previousUnavailable ? <option value={value} disabled>{previousName ?? "Previous participant"} · Needs reassignment</option> : null}
        {eligible.map((person) => <option key={person.id} value={person.id}>{person.displayName}</option>)}
      </select>
    </label>;
}
