import "server-only";
import {
  emailHasAccount, emailHasPendingInvitation, getCommonsInvitationPreview, getGroupInvitationPreview, instanceHasNoAdmin, isInstanceAdmin,
  readInstanceSettings, updateInstanceSignup,
} from "@commons/database";
import { normalizeAllowedDomains, parseSignupMode, type SignupDecision } from "@commons/domain";
import { z } from "zod";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { commonsDatabaseUrl } from "./runtime-environment";

/*
 * Who may create an account on this copy (C18). The instance admin is the first account to sign in. Signing in to an existing account and
 * joining through an invitation always work; only brand-new accounts follow the admin's rule. See packages/domain/src/signup-policy.ts.
 */

import { decideSignup, type SignupLookups as Lookups } from "@/lib/signup-access";

/** True when `next` is an open trip invitation or reusable join link on this copy. */
async function invitationLinkValid(next: string, databaseUrl: string) {
  const personal = /^\/join\/([^/?#]+)/.exec(next);
  if (personal) return (await getCommonsInvitationPreview(decodeURIComponent(personal[1]!), databaseUrl).catch(() => null))?.status === "pending";
  const group = /^\/group-join\/([^/?#]+)/.exec(next);
  if (group) return Boolean(await getGroupInvitationPreview(decodeURIComponent(group[1]!), databaseUrl).catch(() => null));
  return false;
}

function databaseLookups(databaseUrl: string): Lookups {
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
export async function signupAllowedFor(email: string, next: string, lookups?: Lookups, options: { emailVerified?: boolean } = {}): Promise<SignupDecision> {
  const emailVerified = options.emailVerified ?? true;
  const databaseUrl = commonsDatabaseUrl();
  if (!lookups && !databaseUrl) return { allowed: true, reason: "first_account" };
  return decideSignup(lookups ?? databaseLookups(databaseUrl!), email, next, emailVerified);
}

export const SIGNUP_REFUSED_MESSAGE = "This Commons is invite-only. Ask a trip organizer to invite you, then use the link in your invitation.";
export const SIGNUP_DOMAIN_MESSAGE = "Accounts here are limited to certain email domains. Use your invited address, or ask a trip organizer to invite you.";

export async function currentPersonIsInstanceAdmin() {
  const options = await authenticatedCommonsRepositoryOptions().catch(() => null);
  return options ? isInstanceAdmin(options.actorPersonId, options.databaseUrl) : false;
}

export async function loadJoinSettings() {
  const options = await authenticatedCommonsRepositoryOptions();
  const settings = await readInstanceSettings(options.databaseUrl);
  return { isAdmin: settings.adminPersonId === options.actorPersonId, signupMode: parseSignupMode(settings.signupMode), allowedDomains: settings.allowedDomains };
}

export const JoinSettingsSchema = z.object({
  signupMode: z.enum(["invited", "domains", "anyone"]),
  allowedDomains: z.union([z.string().max(2000), z.array(z.string().max(253)).max(50)]).default([]),
});

export async function saveJoinSettings(input: unknown) {
  const options = await authenticatedCommonsRepositoryOptions();
  const parsed = JoinSettingsSchema.parse(input);
  const allowedDomains = normalizeAllowedDomains(parsed.allowedDomains);
  if (parsed.signupMode === "domains" && !allowedDomains.length) throw new z.ZodError([{ code: "custom", path: ["allowedDomains"], message: "Add at least one email domain." }]);
  return updateInstanceSignup(options.actorPersonId, { signupMode: parsed.signupMode, allowedDomains }, options.databaseUrl);
}
