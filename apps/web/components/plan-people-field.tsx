import type { CommonsParticipant } from "@commons/contracts";

export function PlanPeopleField({ participants, selectedIds, protectedIds = [], onChange }: {
  participants: CommonsParticipant[];
  selectedIds: string[];
  protectedIds?: string[];
  onChange: (ids: string[]) => void;
}) {
  return <fieldset className="plan-expected-participants">
    <legend>People for this plan</legend>
    <div>{participants.filter((person) => person.membershipStatus === "active").map((person) => {
      const protectedResponse = protectedIds.includes(person.id);
      const checked = selectedIds.includes(person.id);
      return <label key={person.id} className={checked ? "included" : ""}>
        <input type="checkbox" checked={checked} disabled={protectedResponse} onChange={() => onChange(checked ? selectedIds.filter((id) => id !== person.id) : [...selectedIds, person.id])} />
        <span aria-hidden="true">{person.initials}</span><strong>{person.displayName}</strong>
        <em>{protectedResponse ? "Responded" : person.accessMode === "managed" ? "Managed traveler" : checked ? "Included" : ""}</em>
      </label>;
    })}</div>
    <p>Included for planning, not a personal RSVP. The group can still see this plan.</p>
    {protectedIds.length ? <p>People who have responded keep their response.</p> : null}
  </fieldset>;
}
