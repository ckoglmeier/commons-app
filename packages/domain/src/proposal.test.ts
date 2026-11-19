import assert from "node:assert/strict";
import test from "node:test";
import type { Actor, CommonsState, Proposal } from "@commons/contracts";
import { approveProposal, DomainError, reviseProposal } from "./proposal";

const organizer: Actor = {
  id: "person-casey",
  displayName: "Casey",
  role: "organizer",
  identityState: "claimed",
};

const member: Actor = {
  id: "person-james",
  displayName: "James",
  role: "member",
  identityState: "claimed",
};

function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "proposal-golf",
    commonsId: "commons-cape-cod",
    version: 2,
    status: "proposed",
    title: "Add whale watching Saturday at 9:30 AM",
    summary: "Saturday morning fits the shared plan.",
    affectedPersonIds: ["person-casey", "person-james"],
    createdAt: "2027-08-14T16:00:00.000Z",
    expiresAt: "2027-08-15T00:00:00.000Z",
    evidence: [
      {
        messageId: "message-1",
        excerpt: "Saturday at 9:30?",
        actorName: "Casey",
        occurredAt: "2027-08-14T15:55:00.000Z",
      },
    ],
    payload: {
      kind: "group_activity",
      title: "Whale watching",
      startsAt: "2027-07-24T13:30:00.000Z",
      endsAt: "2027-07-24T16:30:00.000Z",
      location: "Barnstable Harbor",
      participantScope: "everyone",
    },
    ...overrides,
  };
}

function state(item = proposal()): CommonsState {
  return {
    commonsId: "commons-cape-cod",
    messages: [],
    proposals: [item],
    itinerary: [],
    auditEvents: [],
    processedCommandIds: [],
    participation: {},
    expenses: [],
    reimbursements: [],
    moments: [],
  };
}

const command = {
  commandId: "command-approve-golf-v2",
  proposalId: "proposal-golf",
  expectedVersion: 2,
  actor: organizer,
  occurredAt: "2027-08-14T17:00:00.000Z",
};

test("organizer approval updates the proposal, plan, and audit together", () => {
  const result = approveProposal(state(), command);

  assert.equal(result.proposals[0].status, "approved");
  assert.equal(result.itinerary.length, 1);
  assert.equal(result.itinerary[0].title, "Whale watching");
  assert.match(result.itinerary[0].provenanceLabel, /Casey/);
  assert.equal(result.auditEvents[0].action, "proposal.approved");
});

test("a member cannot approve a group-wide activity", () => {
  assert.throws(
    () => approveProposal(state(), { ...command, actor: member }),
    (error: unknown) =>
      error instanceof DomainError && error.code === "actor_not_authorized",
  );
});

test("approval is bound to the exact proposal version", () => {
  assert.throws(
    () => approveProposal(state(), { ...command, expectedVersion: 1 }),
    (error: unknown) =>
      error instanceof DomainError &&
      error.code === "proposal_version_conflict",
  );
});

test("expired proposals cannot mutate the plan", () => {
  assert.throws(
    () =>
      approveProposal(state(), {
        ...command,
        occurredAt: "2027-08-15T00:00:00.000Z",
      }, new Date("2027-08-15T00:00:00.000Z")),
    (error: unknown) =>
      error instanceof DomainError && error.code === "proposal_expired",
  );
});

test("a backdated command cannot bypass expiry and approval uses trusted time", () => {
  const now = new Date("2027-08-14T18:00:00.000Z");
  const result = approveProposal(state(), command, now);
  assert.equal(result.proposals[0].approvedAt, now.toISOString());
  assert.equal(result.auditEvents[0].occurredAt, now.toISOString());
  assert.throws(
    () => approveProposal(state(), command, new Date("2027-08-15T01:00:00.000Z")),
    (error: unknown) => error instanceof DomainError && error.code === "proposal_expired",
  );
});

test("a correction creates a new proposal version without changing the plan", () => {
  const result = reviseProposal(state(), {
    commandId: "correct-golf-v2",
    proposalId: "proposal-golf",
    expectedVersion: 2,
    actor: organizer,
    occurredAt: "2026-06-01T13:00:00.000Z",
    title: "Golf at 9:30 AM",
    startsAt: "2026-06-03T13:30:00.000Z",
    location: "Ocean Course",
    participantScope: "everyone",
    note: "The tee time is 9:30, not 9:00.",
  });

  assert.equal(result.proposals[0].version, 3);
  assert.equal(result.proposals[0].status, "proposed");
  assert.equal(result.proposals[0].payload.kind, "group_activity");
  if (result.proposals[0].payload.kind === "group_activity") {
    assert.equal(result.proposals[0].payload.correction?.actorName, "Casey");
  }
  assert.equal(result.itinerary.length, 0);
  assert.equal(result.auditEvents[0].action, "proposal.revised");
});

test("replaying a command is idempotent", () => {
  const first = approveProposal(state(), command);
  const replay = approveProposal(first, command);

  assert.equal(replay, first);
  assert.equal(replay.itinerary.length, 1);
  assert.equal(replay.auditEvents.length, 1);
});
