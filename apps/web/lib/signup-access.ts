import { parseSignupMode, signupDecision, type SignupDecision } from "@commons/domain";

export type SignupLookups = {
  noAdmin: () => Promise<boolean>;
  hasAccount: (email: string) => Promise<boolean>;
  hasPendingInvitation: (email: string) => Promise<boolean>;
  invitationLinkValid: (next: string) => Promise<boolean>;
  settings: () => Promise<{ signupMode: string; allowedDomains: string[] }>;
};

/**
 * The first account and existing accounts always get in; new accounts follow the admin's rule. `emailVerified: false` (password
 * sign-in, no email set up) means nobody proved they own the address, so an invitation sent to it doesn't count: only a valid invite link does.
 */
export async function decideSignup(look: SignupLookups, email: string, next: string, emailVerified: boolean): Promise<SignupDecision> {
  const [firstAccount, existingAccount] = await Promise.all([look.noAdmin(), look.hasAccount(email)]);
  const invited = !firstAccount && !existingAccount && ((emailVerified && await look.hasPendingInvitation(email)) || await look.invitationLinkValid(next));
  const settings = await look.settings();
  return signupDecision({ email, firstAccount, existingAccount, invited }, { mode: parseSignupMode(settings.signupMode), allowedDomains: settings.allowedDomains });
}
