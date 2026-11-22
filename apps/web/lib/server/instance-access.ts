import "server-only";
import { isInstanceAdmin, readInstanceSettings, updateInstanceSignup } from "@commons/database";
import { normalizeAllowedDomains, parseSignupMode } from "@commons/domain";
import { z } from "zod";
import { authenticatedCommonsRepositoryOptions } from "./commons";

export { signupAllowedFor } from "./account-person";

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
