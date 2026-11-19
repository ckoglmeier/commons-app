import type { CommonsParticipant } from "@commons/contracts";

export function AvatarStack({
  participants,
  compact = false,
}: {
  participants: CommonsParticipant[];
  compact?: boolean;
}) {
  return (
    <div className={`participant-stack${compact ? " participant-stack--compact" : ""}`} aria-label={`${participants.length} travelers`}>
      {participants.slice(0, 3).map((person) => (
        <span key={person.id} title={person.displayName}>{person.initials}</span>
      ))}
      {participants.length > 3 ? <span>+{participants.length - 3}</span> : null}
    </div>
  );
}
