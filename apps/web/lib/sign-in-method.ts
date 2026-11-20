/*
 * How people sign in to this copy (D81).
 * - link: Commons emails a one-time sign-in link (Resend is set up).
 * - password: no email is set up, so people use an email and a password, and organizers share invite links themselves.
 * - test: local test sign-in on a development machine only.
 * - off: nothing is set up yet.
 */
export type SignInMethod = "link" | "password" | "test" | "off";

export function chooseSignInMethod(input: { supabase: boolean; email: boolean; localTest: boolean }): SignInMethod {
  if (!input.supabase) return input.localTest ? "test" : "off";
  return input.email ? "link" : "password";
}
