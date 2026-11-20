"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { renderCommonsAuthenticationEmail, type AuthenticationEmailIntent } from "@/lib/email/authentication-email";
import { sendEmail } from "@/lib/email/resend";
import { createConfirmedPasswordAccount, createPasswordlessEntryUrl, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { currentSignInMethod } from "@/lib/server/sign-in-method";
import { accountCreationPath, safeAuthNext } from "@/lib/auth-flow";
import { redirect } from "next/navigation";
import { findPersonIdForAuthUser } from "@commons/database";
import { SIGNUP_DOMAIN_MESSAGE, SIGNUP_REFUSED_MESSAGE, signupAllowedFor } from "@/lib/server/instance-access";
import { devSignInAvailable, startDevSession } from "@/lib/server/dev-session";
import { commonsDatabaseUrl } from "@/lib/server/runtime-environment";

export type SignInState = {
  status?: "email-sent" | "error";
  message?: string;
};

const contextSchema = {
  next: z.string().optional(),
  intent: z.enum(["sign-in", "create", "invited"]).optional(),
};
const EmailSchema = z.object({ email: z.email(), ...contextSchema });

async function unavailable(): Promise<SignInState | null> {
  return isSupabaseAuthConfigured() || await devSignInAvailable() ? null : { status: "error", message: "Sign-in isn’t set up on this copy of Commons yet." };
}

export async function requestSignInLink(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const disabled = await unavailable();
  if (disabled) return disabled;
  const parsed = EmailSchema.safeParse({
    email: formData.get("email"),
    next: formData.get("next") || undefined, intent: formData.get("intent") || undefined,
  });
  if (!parsed.success) return { status: "error", message: "Enter a valid email address." };
  const requestHeaders = await headers();
  const origin = requestHeaders.get("origin") ?? `${requestHeaders.get("x-forwarded-proto") ?? "https"}://${requestHeaders.get("host")}`;
  const next = safeAuthNext(parsed.data.next);
  const intent: AuthenticationEmailIntent = parsed.data.intent ?? "sign-in";
  // Who may create an account here is the instance admin's choice. The same answer for any refused email, whether or not it exists.
  const decision = await signupAllowedFor(parsed.data.email, next).catch(() => null);
  if (!decision) return { status: "error", message: "Sign-in link not sent. Try again." };
  if (!decision.allowed) return { status: "error", message: decision.reason === "domain_not_listed" ? SIGNUP_DOMAIN_MESSAGE : SIGNUP_REFUSED_MESSAGE };
  if (!isSupabaseAuthConfigured()) {
    // Local test sign-in (development only, localhost only): no email; this browser is signed in as that made-up person.
    const identity = await startDevSession(parsed.data.email);
    const databaseUrl = commonsDatabaseUrl();
    const known = databaseUrl ? await findPersonIdForAuthUser(identity.authUserId, databaseUrl).catch(() => null) : null;
    redirect(known ? next : accountCreationPath(next, intent));
  }
  if (isSupabaseAdminConfigured()) {
    try {
      const signInUrl = await createPasswordlessEntryUrl(parsed.data.email, next, origin, intent);
      await sendEmail({ ...renderCommonsAuthenticationEmail({ email: parsed.data.email, signInUrl, intent }), to: parsed.data.email, idempotencyKey: `commons-auth-${crypto.randomUUID()}` });
      return { status: "email-sent", message: "Sign-in link sent. Check your email." };
    } catch {
      return { status: "error", message: "Sign-in link not sent. Try again." };
    }
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithOtp({
    email: parsed.data.email,
    options: { shouldCreateUser: true, emailRedirectTo: `${origin}/auth/confirm?next=${encodeURIComponent(next)}&intent=${intent}` },
  });
  return error ? { status: "error", message: "Sign-in link not sent. Try again." } : { status: "email-sent", message: "Sign-in link sent. Check your email." };
}

const PasswordSchema = z.object({
  email: z.email(),
  password: z.string().min(8).max(200),
  mode: z.enum(["sign-in", "create"]),
  ...contextSchema,
});

/** Sign in or create an account with a password. Used only when this copy has no email set up (D81). */
export async function signInWithPassword(_previous: SignInState, formData: FormData): Promise<SignInState> {
  if (await currentSignInMethod() !== "password") return { status: "error", message: "This copy of Commons signs in with emailed links." };
  const parsed = PasswordSchema.safeParse({
    email: formData.get("email"), password: formData.get("password"), mode: formData.get("mode"),
    next: formData.get("next") || undefined, intent: formData.get("intent") || undefined,
  });
  if (!parsed.success) {
    const passwordProblem = parsed.error.issues.some(issue => issue.path[0] === "password");
    return { status: "error", message: passwordProblem ? "Use a password of at least 8 characters." : "Enter a valid email address." };
  }
  const { email, password, mode } = parsed.data;
  const next = safeAuthNext(parsed.data.next);
  const intent: AuthenticationEmailIntent = parsed.data.intent ?? "sign-in";
  if (mode === "create") {
    // Nobody has proved they own this address, so only an invite link (or the admin's open rule) lets a new person in.
    const decision = await signupAllowedFor(email, next, undefined, { emailVerified: false }).catch(() => null);
    if (!decision) return { status: "error", message: "Account not created. Try again." };
    if (!decision.allowed) return { status: "error", message: decision.reason === "domain_not_listed" ? SIGNUP_DOMAIN_MESSAGE : SIGNUP_REFUSED_MESSAGE };
    if (!isSupabaseAdminConfigured()) return { status: "error", message: "Accounts can’t be created on this copy yet. Whoever runs it needs to add the Supabase secret key." };
    try {
      if (await createConfirmedPasswordAccount(email, password) === "exists") return { status: "error", message: "An account with this email already exists. Sign in instead." };
    } catch {
      return { status: "error", message: "Account not created. Try again." };
    }
  }
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return { status: "error", message: "That email and password don’t match. If you forgot your password, ask whoever runs this Commons to reset it." };
  const databaseUrl = commonsDatabaseUrl();
  const known = databaseUrl ? await findPersonIdForAuthUser(data.user.id, databaseUrl).catch(() => null) : null;
  redirect(known ? next : accountCreationPath(next, intent));
}
