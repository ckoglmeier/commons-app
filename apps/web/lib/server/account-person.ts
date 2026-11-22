import "server-only";
import {
  emailHasAccount, emailHasPendingInvitation, findOrClaimPersonForAuthIdentity, findPersonIdForAuthUser, getCommonsInvitationPreview,
  getGroupInvitationPreview, instanceHasNoAdmin, readInstanceSettings, type AuthenticatedIdentity,
} from "@commons/database";
import type { SignupDecision } from "@commons/domain";
import { decideSignup, type SignupLookups } from "@/lib/signup-access";
import { commonsDatabaseUrl } from "./runtime-environment";
import { CommonsJoinRefusedError } from "./commons-access-errors";

export const SIGNUP_REFUSED_MESSAGE = "This Commons is invite-only. Ask a trip organizer to invite you, then use the link in your invitation.";
export const SIGNUP_DOMAIN_MESSAGE = "Accounts here are limited to certain email domains. Use your invited address, or ask a trip organizer to invite you.";

export function signupRefusalMessage(decision: SignupDecision) {
  return decision.reason === "domain_not_listed" ? SIGNUP_DOMAIN_MESSAGE : SIGNUP_REFUSED_MESSAGE;
}

/*
 * Who may create an account on this copy (C18). The instance admin is the first account to sign in. Signing in to an existing account and
 * joining through an invitation always work; only brand-new accounts follow the admin's rule. See packages/domain/src/signup-policy.ts.
 */

/** True when `next` is an open trip invitation or reusable join link on this copy. */
async function invitationLinkValid(next: string, databaseUrl: string) {
  const personal = /^\/join\/([^/?#]+)/.exec(next);
  if (personal) return (await getCommonsInvitationPreview(decodeURIComponent(personal[1]!), databaseUrl).catch(() => null))?.status === "pending";
  const group = /^\/group-join\/([^/?#]+)/.exec(next);
  if (group) return Boolean(await getGroupInvitationPreview(decodeURIComponent(group[1]!), databaseUrl).catch(() => null));
  return false;
}

function databaseLookups(databaseUrl: string): SignupLookups {
  return {
    noAdmin: () => instanceHasNoAdmin(databaseUrl),
    hasAccount: email => emailHasAccount(email, databaseUrl),
    hasPendingInvitation: email => emailHasPendingInvitation(email, databaseUrl),
    invitationLinkValid: next => invitationLinkValid(next, databaseUrl),
    settings: () => readInstanceSettings(databaseUrl),
  };
}

/**
 * Whether this email may sign in or create an account. With no database there is nothing to protect yet, so it's allowed.
 * `emailVerified: false` (password sign-in, no email set up) means nobody has proved they own the address, so an invitation
 * sent to that address doesn't count; only holding a valid invite link does.
 */
export async function signupAllowedFor(email: string, next: string, lookups?: SignupLookups, options: { emailVerified?: boolean } = {}): Promise<SignupDecision> {
  const emailVerified = options.emailVerified ?? true;
  const databaseUrl = commonsDatabaseUrl();
  if (!lookups && !databaseUrl) return { allowed: true, reason: "first_account" };
  return decideSignup(lookups ?? databaseLookups(databaseUrl!), email, next, emailVerified);
}

/**
 * The Commons person for a signed-in account. Every server path that resolves one goes through here, so an account made outside Commons
 * (for example straight through Supabase's own signup) still meets Who can join before it gets a profile. An account that already has a
 * person keeps it. `next` is where the account is headed, so an invite link it holds counts.
 */
export async function personForSignedInAccount(identity: AuthenticatedIdentity, databaseUrl: string, next = "") {
  return (await placeSignedInAccount(identity, databaseUrl, next)).personId;
}

/** As personForSignedInAccount, also saying when Who can join is the reason the account has no person. */
export async function placeSignedInAccount(identity: AuthenticatedIdentity, databaseUrl: string, next = "") {
  if (await findPersonIdForAuthUser(identity.authUserId, databaseUrl)) return { personId: await findOrClaimPersonForAuthIdentity(identity, databaseUrl), refused: null };
  const decision = await signupAllowedFor(identity.email ?? "", next, undefined, { emailVerified: identity.emailProvesIdentity !== false });
  const personId = await findOrClaimPersonForAuthIdentity(identity, databaseUrl, { allowNewPerson: decision.allowed });
  return { personId, refused: personId || decision.allowed ? null : decision };
}

/** The account's person, or a CommonsJoinRefusedError that says why Who can join keeps it out. Null for other reasons (no name yet). */
export async function signedInPersonOrRefusal(identity: AuthenticatedIdentity, databaseUrl: string, next = "") {
  const { personId, refused } = await placeSignedInAccount(identity, databaseUrl, next);
  if (refused) throw new CommonsJoinRefusedError(signupRefusalMessage(refused));
  return personId;
}
