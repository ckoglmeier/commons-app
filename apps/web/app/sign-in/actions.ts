"use server";

import { headers } from "next/headers";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { renderCommonsAuthenticationEmail, type AuthenticationEmailIntent } from "@/lib/email/authentication-email";
import { sendEmail } from "@/lib/email/resend";
import { createPasswordlessEntryUrl, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { safeAuthNext } from "@/lib/auth-flow";

export type SignInState = {
  status?: "email-sent" | "error";
  message?: string;
};

const contextSchema = {
  next: z.string().optional(),
  intent: z.enum(["sign-in", "create", "invited", "access"]).optional(),
};
const EmailSchema = z.object({ email: z.email(), ...contextSchema });

function unavailable(): SignInState | null {
  return isSupabaseAuthConfigured() ? null : { status: "error", message: "Sign-in isn’t available in this preview." };
}

export async function requestSignInLink(_previous: SignInState, formData: FormData): Promise<SignInState> {
  const disabled = unavailable();
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
