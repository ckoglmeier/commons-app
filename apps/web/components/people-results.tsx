import type { CommonsParticipant, EventAttendance } from "@commons/contracts";

const attendanceLabels = { helping: "Helping plan", attending: "Attending", declined: "Declined", needs_confirmation: "Dates changed · confirmation needed" };

/** Shared results only. Access and preference controls belong in PeopleSheet. */
export function PeopleResults({ participants, attendance }: { participants: CommonsParticipant[]; attendance?: EventAttendance | null }) {
  return <section className="event-logistics-section" aria-labelledby="people-results-title">
    <div className="event-logistics-heading"><h3 id="people-results-title">People</h3></div>
    <p>{participants.filter(person => person.membershipStatus === "active").length} Joined · {participants.filter(person => person.membershipStatus === "invited").length} Invited</p>
    <ul className="event-attendance-list">{participants.map(person => {
      const answer = attendance?.people.find(answer => answer.personId === person.id);
      return <li key={person.id}><div><strong>{person.displayName}</strong>{person.accessMode === "managed" ? <small> · Managed traveler</small> : null}
        {Object.values(person.sharedPreferences ?? {}).some(Boolean) ? <div className="shared-preferences"><strong>Shared with this event</strong>{Object.values(person.sharedPreferences ?? {}).filter(Boolean).map(value => <span key={value}>{value}</span>)}</div> : null}
      </div><span>{answer ? attendanceLabels[answer.state] : person.membershipStatus === "active" ? "Joined" : "Invited"}</span></li>;
    })}</ul>
  </section>;
}
