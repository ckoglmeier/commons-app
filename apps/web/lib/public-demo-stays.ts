import type { CommonsParticipant, CommonsSummary, Stay } from "@commons/contracts";
import { PUBLIC_DEMO_COMMONS_ID } from "./commons-route";

export function publicDemoStays(commons: CommonsSummary, participants: CommonsParticipant[], existing: Stay[]): Stay[] {
  if (commons.id !== PUBLIC_DEMO_COMMONS_ID) throw new Error("Only the public sample supports a local stay preview.");
  const legacy: Stay[] = !existing.length && commons.lodging && commons.startsOn && commons.endsOn ? [{
    id: "cape-demo-original-stay", name: commons.lodging.name, address: commons.lodging.address,
    startsOn: commons.startsOn, endsOn: commons.endsOn, status: "planned",
    includedPersonIds: participants.filter(person => person.membershipStatus === "active").map(person => person.id),
    sourceLabel: commons.lodging.sourceLabel,
  }] : [];
  return [...legacy, ...existing];
}

export function appendPublicDemoStay(commons: CommonsSummary, participants: CommonsParticipant[], existing: Stay[], added: Stay): Stay[] {
  return [...publicDemoStays(commons, participants, existing), added];
}
