"use server";

import { findOrClaimPersonForAuthIdentity } from "@commons/database";
import { headers } from "next/headers";
import { recordOutcome } from "@/lib/server/outcome-telemetry";
import { redirect } from "next/navigation";
import { z } from "zod";
import { safeAuthNext, hasCompletedAccountName } from "@/lib/auth-flow";
import { commonsDatabaseUrl, textMessagingAvailable } from "@/lib/server/runtime-environment";
import { createSupabaseServerClient, getDevSignInIdentity } from "@/lib/supabase/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { startDevSession } from "@/lib/server/dev-session";

export type CreateAccountState = { message?: string };

const CreateAccountSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  next: z.string().optional(),
});

export async function completeAccount(
  _previous: CreateAccountState,
  formData: FormData,
): Promise<CreateAccountState> {
  const parsed = CreateAccountSchema.safeParse({
    firstName: formData.get("firstName"),
    next: formData.get("next") || undefined,
  });
  if (!parsed.success) return { message: "Enter your first name." };

  if (!isSupabaseAuthConfigured()) {
    // Local test sign-in: the name lives in this browser's test session.
    const current = await getDevSignInIdentity();
    if (!current) return { message: "Sign in again before creating your account." };
    const identity = await startDevSession(current.email, parsed.data.firstName);
    const databaseUrl = commonsDatabaseUrl();
    if (databaseUrl) {
      try { await findOrClaimPersonForAuthIdentity({ ...identity, displayName: parsed.data.firstName }, databaseUrl); }
      catch { return { message: "Account not created. Try again." }; }
    }
    redirect(safeAuthNext(parsed.data.next));
  }

  const supabase = await createSupabaseServerClient();
  const { data: current, error: sessionError } = await supabase.auth.getUser();
  if (sessionError || !current.user) return { message: "Sign in again before creating your account." };

  const completingSetup = !hasCompletedAccountName(current.user.user_metadata) || current.user.user_metadata?.commons_account_setup_version === 1;
  const { data, error } = await supabase.auth.updateUser({
    data: { first_name: parsed.data.firstName, ...(completingSetup ? { commons_account_setup_version: 1 } : {}) },
  });
  if (error || !data.user) return { message: "Account not created. Your sign-in is still safe. Try again." };

  const databaseUrl = commonsDatabaseUrl();
  if (databaseUrl) {
    try {
      await findOrClaimPersonForAuthIdentity({
        authUserId: data.user.id,
        email: data.user.email,
        phone: data.user.phone,
        displayName: parsed.data.firstName,
      }, databaseUrl);
    } catch {
      return { message: "Account not created. Your sign-in is still safe. Try again." };
    }
  }

  // Successful account setup is distinct from a later sign-in. Stable account key deduplicates retries.
  const requestHeaders = await headers();
  if (completingSetup) recordOutcome({ event: "account_setup_completed", key: data.user.id, request: new Request("https://www.commons.travel/account/create", { headers: requestHeaders }) });
  const next = safeAuthNext(parsed.data.next);
  // Optional, and only once texts can actually be sent. The invitation or destination carries through it.
  if (completingSetup && textMessagingAvailable()) redirect(`/account/phone?next=${encodeURIComponent(next)}`);
  redirect(next);
}
