import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { accountCreationPath, hasCompletedAccountName, safeAuthNext, type AuthIntent } from "@/lib/auth-flow";

function authIntent(value: string | null): AuthIntent {
  return value === "create" || value === "invited" || value === "access" ? value : "sign-in";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeAuthNext(url.searchParams.get("next"));
  const intent = authIntent(url.searchParams.get("intent"));
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const supabase = await createSupabaseServerClient();

  const result = code
    ? await supabase.auth.exchangeCodeForSession(code)
    : tokenHash && type
      ? await supabase.auth.verifyOtp({ token_hash: tokenHash, type })
      : { error: new Error("Missing confirmation token.") };

  if (result.error) {
    const signInUrl = new URL("/sign-in", url.origin);
    signInUrl.searchParams.set("next", next);
    signInUrl.searchParams.set("intent", intent);
    signInUrl.searchParams.set("error", "confirmation_failed");
    return NextResponse.redirect(signInUrl);
  }
  const { data } = await supabase.auth.getUser();
  const destination = hasCompletedAccountName(data.user?.user_metadata)
    ? next
    : accountCreationPath(next, intent);
  return NextResponse.redirect(new URL(destination, url.origin));
}
