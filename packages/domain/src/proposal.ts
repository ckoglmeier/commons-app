import {
  ApproveProposalCommandSchema,
  ReviseProposalCommandSchema,
  type Actor,
  type Proposal,
} from "@commons/contracts";
import type { CommonsState, ItineraryItem } from "@commons/contracts";

export type DomainErrorCode =
  | "proposal_not_found"
  | "proposal_not_open"
  | "proposal_version_conflict"
  | "proposal_expired"
  | "actor_not_verified"
  | "actor_not_authorized";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export function canApproveProposal(actor: Actor, proposal: Proposal) {
  if (actor.identityState === "observed") {
    return {
      allowed: false,
      reason: "Only a verified participant can approve shared state.",
    } as const;
  }

  if (proposal.payload.kind === "group_activity") {
    return actor.role === "organizer"
      ? ({ allowed: true } as const)
      : ({
          allowed: false,
          reason: "An organizer must approve a group-wide activity.",
        } as const);
  }

  return { allowed: true } as const;
}

function itineraryItemFromProposal(
  proposal: Proposal,
  actor: Actor,
): ItineraryItem | null {
  if (proposal.payload.kind !== "group_activity") return null;

  return {
    id: `itinerary-${proposal.id}-v${proposal.version}`,
    proposalId: proposal.id,
    title: proposal.payload.title,
    startsAt: proposal.payload.startsAt,
    endsAt: proposal.payload.endsAt,
    location: proposal.payload.location,
    participantScope: proposal.payload.participantScope,
    status: "planned",
    provenanceLabel: `Approved by ${actor.displayName} · proposal v${proposal.version}`,
  };
}

export function approveProposal(
  currentState: CommonsState,
  rawCommand: unknown,
  now = new Date(),
): CommonsState {
  const command = { ...ApproveProposalCommandSchema.parse(rawCommand), occurredAt: now.toISOString() };

  if (currentState.processedCommandIds.includes(command.commandId)) {
    return currentState;
  }

  const proposalIndex = currentState.proposals.findIndex(
    (proposal) => proposal.id === command.proposalId,
  );

  if (proposalIndex === -1) {
    throw new DomainError("proposal_not_found", "That proposal no longer exists.");
  }

  const proposal = currentState.proposals[proposalIndex];

  if (proposal.version !== command.expectedVersion) {
    throw new DomainError(
      "proposal_version_conflict",
      "This proposal changed. Review the current version before approving it.",
    );
  }

  if (proposal.status !== "proposed") {
    throw new DomainError(
      "proposal_not_open",
      `Proposal ${proposal.id} is already ${proposal.status}.`,
    );
  }

  if (Date.parse(proposal.expiresAt) <= Date.parse(command.occurredAt)) {
    throw new DomainError(
      "proposal_expired",
      "This proposal expired. Commons needs to confirm the plan again.",
    );
  }

  const authority = canApproveProposal(command.actor, proposal);
  if (!authority.allowed) {
    throw new DomainError(
      command.actor.identityState === "observed"
        ? "actor_not_verified"
        : "actor_not_authorized",
      authority.reason,
    );
  }

  const approvedProposal: Proposal = {
    ...proposal,
    status: "approved",
    approvedBy: command.actor.id,
    approvedAt: command.occurredAt,
  };
  const itineraryItem = itineraryItemFromProposal(
    approvedProposal,
    command.actor,
  );
  const proposals = [...currentState.proposals];
  proposals[proposalIndex] = approvedProposal;

  return {
    ...currentState,
    proposals,
    itinerary: itineraryItem
      ? [
          ...currentState.itinerary.filter(
            (item) => item.proposalId !== proposal.id,
          ),
          itineraryItem,
        ].sort((a, b) => (a.startsAt ?? "").localeCompare(b.startsAt ?? ""))
      : currentState.itinerary,
    auditEvents: [
      ...currentState.auditEvents,
      {
        id: `audit-${command.commandId}`,
        commandId: command.commandId,
        actorId: command.actor.id,
        action: "proposal.approved",
        targetId: proposal.id,
        occurredAt: command.occurredAt,
        summary: `${command.actor.displayName} approved ${proposal.title} v${proposal.version}.`,
      },
    ],
    processedCommandIds: [
      ...currentState.processedCommandIds,
      command.commandId,
    ],
  };
}

export function reviseProposal(
  currentState: CommonsState,
  rawCommand: unknown,
  now = new Date(),
): CommonsState {
  const command = { ...ReviseProposalCommandSchema.parse(rawCommand), occurredAt: now.toISOString() };

  if (currentState.processedCommandIds.includes(command.commandId)) {
    return currentState;
  }

  const proposalIndex = currentState.proposals.findIndex(
    (proposal) => proposal.id === command.proposalId,
  );
  if (proposalIndex === -1) {
    throw new DomainError("proposal_not_found", "That proposal no longer exists.");
  }

  const proposal = currentState.proposals[proposalIndex];
  if (proposal.version !== command.expectedVersion) {
    throw new DomainError(
      "proposal_version_conflict",
      "This proposal changed. Review the current version before correcting it.",
    );
  }
  if (proposal.status !== "proposed") {
    throw new DomainError(
      "proposal_not_open",
      "Only a proposal waiting for approval can be corrected.",
    );
  }
  if (command.actor.identityState === "observed") {
    throw new DomainError(
      "actor_not_verified",
      "Join the Commons before correcting a shared proposal.",
    );
  }

  const revisedProposal: Proposal = {
    ...proposal,
    version: proposal.version + 1,
    status: "proposed",
    title: `Add ${command.title}`,
    summary: `${command.actor.displayName.split(" ")[0]} corrected the proposed plan. Review this version before it changes the itinerary.`,
    createdAt: command.occurredAt,
    expiresAt: new Date(Date.parse(command.occurredAt) + 24 * 60 * 60 * 1_000).toISOString(),
    payload: {
      kind: "group_activity",
      title: command.title,
      startsAt: command.startsAt,
      endsAt: command.endsAt,
      location: command.location,
      participantScope: command.participantScope,
      correction: {
        actorName: command.actor.displayName,
        note: command.note,
        occurredAt: command.occurredAt,
      },
    },
    approvedBy: undefined,
    approvedAt: undefined,
  };
  const proposals = [...currentState.proposals];
  proposals[proposalIndex] = revisedProposal;

  return {
    ...currentState,
    proposals,
    auditEvents: [
      ...currentState.auditEvents,
      {
        id: `audit-${command.commandId}`,
        commandId: command.commandId,
        actorId: command.actor.id,
        action: "proposal.revised",
        targetId: proposal.id,
        occurredAt: command.occurredAt,
        summary: `${command.actor.displayName} corrected ${proposal.title} as version ${revisedProposal.version}.`,
      },
    ],
    processedCommandIds: [...currentState.processedCommandIds, command.commandId],
  };
}
