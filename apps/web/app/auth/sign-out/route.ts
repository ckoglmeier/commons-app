import { NextResponse } from "next/server";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { safeAuthNext, type AuthIntent } from "@/lib/auth-flow";

export async function POST(request: Request) {
  if (isSupabaseAuthConfigured()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  const url = new URL(request.url);
  const next = safeAuthNext(url.searchParams.get("next"));
  const intent = url.searchParams.get("intent");
  const signIn = new URL("/sign-in", request.url);
  signIn.searchParams.set("next", next);
  if (["sign-in", "create", "invited", "access"].includes(intent ?? "")) {
    signIn.searchParams.set("intent", intent as AuthIntent);
  }
  return NextResponse.redirect(signIn, 303);
}
