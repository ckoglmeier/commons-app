import "server-only";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";
import { emailDeliveryAvailable } from "@/lib/email/resend";
import { devSignInAvailable } from "./dev-session";
import { chooseSignInMethod, type SignInMethod } from "@/lib/sign-in-method";

export async function currentSignInMethod(): Promise<SignInMethod> {
  const supabase = isSupabaseAuthConfigured();
  return chooseSignInMethod({ supabase, email: emailDeliveryAvailable(), localTest: !supabase && await devSignInAvailable() });
}
