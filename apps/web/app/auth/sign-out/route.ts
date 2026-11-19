import { NextResponse } from "next/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAuthNext, type AuthIntent } from "@/lib/auth-flow";
import { endDevSession } from "@/lib/server/dev-session";

export async function POST(request: Request) {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  } else {
    await endDevSession();
  }
  const url = new URL(request.url);
  const next = safeAuthNext(url.searchParams.get("next"));
  const intent = url.searchParams.get("intent");
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", next);
  if (["sign-in", "create", "invited"].includes(intent ?? "")) {
    signIn.searchParams.set("intent", intent as AuthIntent);
  }
  return NextResponse.redirect(signIn, 303);
}
