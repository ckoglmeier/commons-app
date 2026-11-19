import { invitationProofMatches, readInvitationEmailProof, type getInvitationEntryContext } from "@commons/database";
import { accountCreationPath, hasCompletedAccountName } from "./auth-flow";

export function invitationReturnPath(token: string, poll?: string | null) {
  return `/join/${encodeURIComponent(token)}/${poll && /^[0-9a-f]{12}$/.test(poll) ? `?poll=${poll}` : ""}`;
}

export function maskedInvitationEmail(email: string) {
  const [name, domain] = email.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
}

type Context = NonNullable<Awaited<ReturnType<typeof getInvitationEntryContext>>>;
type Verified = { authUserId: string; email: string; metadata: Record<string, unknown>; access_token: string; refresh_token: string };

// No provider verification on GET. This service is invoked only by the explicit server action.
export async function redeemInvitationEmail(input: {
  token: string; entry: string; poll?: string; expectedCurrentAccountId: string;
}, dependencies: {
  context: () => Promise<Context | null>;
  currentAccount: () => Promise<{ authUserId: string } | null>;
  verify: (proof: NonNullable<ReturnType<typeof readInvitationEmailProof>>) => Promise<Verified | null>;
  establishSession: (verified: Verified) => Promise<void>;
}) {
  const proof = readInvitationEmailProof(input.entry, input.token);
  const context = await dependencies.context();
  if (!proof || !context || !invitationProofMatches(proof, context)) return { error: "expired" as const };
  const current = await dependencies.currentAccount();
  if ((current?.authUserId ?? "") !== input.expectedCurrentAccountId) return { error: "account_changed" as const };
  const next = invitationReturnPath(input.token, input.poll);
  if (current?.authUserId === proof.authUserId) return { destination: next };
  const verified = await dependencies.verify(proof);
  if (!verified || verified.authUserId !== proof.authUserId || verified.email.trim().toLowerCase() !== proof.email) return { error: "expired" as const };
  // Recheck revocation/reassignment after the network call, before writing browser session cookies.
  const latest = await dependencies.context();
  if (!latest || !invitationProofMatches(proof, latest)) return { error: "expired" as const };
  await dependencies.establishSession(verified);
  return { destination: hasCompletedAccountName(verified.metadata) ? next : accountCreationPath(next, "invited") };
}
