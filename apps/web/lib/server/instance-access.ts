import "server-only";
import {
  emailHasAccount, emailHasPendingInvitation, getCommonsInvitationPreview, getGroupInvitationPreview, instanceHasNoAdmin, isInstanceAdmin,
  readInstanceSettings, updateInstanceSignup,
} from "@commons/database";
import { normalizeAllowedDomains, parseSignupMode, signupDecision, type SignupDecision } from "@commons/domain";
import { z } from "zod";
import { authenticatedCommonsRepositoryOptions } from "./commons";
import { commonsDatabaseUrl } from "./runtime-environment";

/*
 * Who may create an account on this copy (C18). The instance admin is the first account to sign in. Signing in to an existing account and
 * joining through an invitation always work; only brand-new accounts follow the admin's rule. See packages/domain/src/signup-policy.ts.
 */

type Lookups = {
  noAdmin: () => Promise<boolean>;
  hasAccount: (email: string) => Promise<boolean>;
  hasPendingInvitation: (email: string) => Promise<boolean>;
  invitationLinkValid: (next: string) => Promise<boolean>;
  settings: () => Promise<{ signupMode: string; allowedDomains: string[] }>;
};

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

/** Whether this email may get a sign-in link. With no database there is nothing to protect yet, so it's allowed. */
export async function signupAllowedFor(email: string, next: string, lookups?: Lookups): Promise<SignupDecision> {
  const databaseUrl = commonsDatabaseUrl();
  if (!lookups && !databaseUrl) return { allowed: true, reason: "first_account" };
  const look = lookups ?? databaseLookups(databaseUrl!);
  const [firstAccount, existingAccount] = await Promise.all([look.noAdmin(), look.hasAccount(email)]);
  const invited = !firstAccount && !existingAccount && (await look.hasPendingInvitation(email) || await look.invitationLinkValid(next));
  const settings = await look.settings();
  return signupDecision({ email, firstAccount, existingAccount, invited }, { mode: parseSignupMode(settings.signupMode), allowedDomains: settings.allowedDomains });
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
