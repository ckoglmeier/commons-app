type SavedInvitee = {
  role: string;
  invitation: { status: string; deliveryState: string } | null;
} | undefined;

/** Only drain the new attempt reserved by this add/invite transaction.
 * A queued existing invitation is never authorization to send it again.
 */
export async function autoSendTravelerInvitation(person: SavedInvitee, newAttemptId: string | null | undefined, send: () => Promise<unknown>) {
  if (!newAttemptId || person?.role !== "member" || person.invitation?.status !== "pending" || person.invitation.deliveryState !== "queued") return;
  await send();
}
