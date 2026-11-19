/**
 * Who may create an account on this copy of Commons. The instance admin (the first account) chooses one of three rules.
 * Signing in to an existing account, and joining a trip through an invitation, never depend on the rule: travelers who
 * only join a trip never choose anything.
 */
export const SIGNUP_MODES = ["invited", "domains", "anyone"] as const;
export type SignupMode = (typeof SIGNUP_MODES)[number];
export const DEFAULT_SIGNUP_MODE: SignupMode = "invited";

export type SignupSettings = { mode: SignupMode; allowedDomains: readonly string[] };

export type SignupRequest = {
  email: string;
  /** No instance admin exists yet: this account will become the admin. */
  firstAccount: boolean;
  /** The email already belongs to an account here. */
  existingAccount: boolean;
  /** A pending trip invitation names this email, or the person arrived through a valid invitation link. */
  invited: boolean;
};

export type SignupDecision = { allowed: true; reason: "first_account" | "existing_account" | "invited" | "anyone" | "domain" } | { allowed: false; reason: "invited_only" | "domain_not_listed" };

export function emailDomain(email: string) {
  const at = email.trim().toLowerCase().lastIndexOf("@");
  return at > 0 ? email.trim().toLowerCase().slice(at + 1) : "";
}

/** Normalizes an admin-entered domain list: lowercase, no leading "@", no blanks or duplicates, at most 50. */
export function normalizeAllowedDomains(input: readonly string[] | string): string[] {
  const values = typeof input === "string" ? input.split(/[\s,]+/) : input;
  const domains = values.map(value => value.trim().toLowerCase().replace(/^@+/, "")).filter(value => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/.test(value));
  return [...new Set(domains)].slice(0, 50);
}

export function parseSignupMode(value: unknown): SignupMode {
  return SIGNUP_MODES.includes(value as SignupMode) ? value as SignupMode : DEFAULT_SIGNUP_MODE;
}

export function signupDecision(request: SignupRequest, settings: SignupSettings): SignupDecision {
  if (request.firstAccount) return { allowed: true, reason: "first_account" };
  if (request.existingAccount) return { allowed: true, reason: "existing_account" };
  if (request.invited) return { allowed: true, reason: "invited" };
  if (settings.mode === "anyone") return { allowed: true, reason: "anyone" };
  if (settings.mode === "domains") {
    const domain = emailDomain(request.email);
    return domain && settings.allowedDomains.includes(domain) ? { allowed: true, reason: "domain" } : { allowed: false, reason: "domain_not_listed" };
  }
  return { allowed: false, reason: "invited_only" };
}
