export type TripInviteState =
  | "exempt" | "allowed"
  | "approval_revoked"
  | "payment_required" | "payment_processing"
  | "refund_hold";

export type TripActivationStatus = {
  required: boolean;
  state: TripInviteState;
  mayInvite: boolean;
  draftId: string | null;
  tripId: string | null;
  feeCents: number;
  checkoutOpen: boolean;
  failureCode: string | null;
  refundedCents: number;
  /** A refund arrived after people were invited. Everyone keeps access; the ledger needs a human look. */
  reconciliationNeeded: boolean;
  /** False while the trip is still getting to a decision. */
  going: boolean;
  /** People added in setup who were left out of a private trip. They are not invited; the organizer adds them from People. */
  savedPeople: { name: string; hasEmail: boolean }[];
  /** Invitations that exist but haven't gone out, or failed. Never counted as delivered. */
  unsentInvitees: string[];
};
