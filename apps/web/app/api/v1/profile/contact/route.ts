import { NextResponse } from "next/server";
import { z } from "zod";
import { contactUpdateError } from "@/lib/contact-methods";
import { json, messagingRoute } from "@/lib/server/messaging/http";
import { confirmPhoneCode, sendPhoneCode } from "@/lib/server/messaging/phone-verification";
import { commonsSiteOrigin, textMessagingAvailable } from "@/lib/server/runtime-environment";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const RequestSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("phone"), value: z.string().trim().min(7).max(24) }),
  z.object({ kind: z.literal("email"), value: z.email() }),
]);

/** Without Twilio settings, a phone request is refused before it touches the session, the database or a provider. */
const phoneUnavailable = () => NextResponse.json({ error: "Text-message verification is not available yet. Use email to sign in." }, { status: 503 });
const refusal = (result: { status: number; code: string; message: string }) => json({ error: result.message, code: result.code }, result.status);

export async function POST(request: Request) {
  const parsed = RequestSchema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Check that contact method and try again." }, { status: 400 });

  if (parsed.data.kind === "phone") {
    if (!textMessagingAvailable()) return phoneUnavailable();
    const { value } = parsed.data;
    return messagingRoute(async () => {
      const result = await sendPhoneCode({ value });
      return result.ok ? json({ status: "code_sent", phone: result.phone }) : refusal(result);
    });
  }

  const supabase = await createSupabaseServerClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) return NextResponse.json({ error: "Sign in again to update your profile." }, { status: 401 });

  const email = parsed.data.value.trim().toLowerCase();
  if (email === userData.user.email?.toLowerCase()) return NextResponse.json({ error: "That is already your verified email." }, { status: 400 });
  const origin = commonsSiteOrigin(new URL(request.url).origin);
  const { error } = await supabase.auth.updateUser(
    { email },
    { emailRedirectTo: `${origin}/auth/confirm?next=%2Fprofile&intent=sign-in` },
  );
  if (error) return NextResponse.json({ error: contactUpdateError("email", error) }, { status: 409 });
  return NextResponse.json({ status: "confirmation_sent", email, requiresCurrentEmailConfirmation: Boolean(userData.user.email) });
}

/** Check a code. The number becomes the person's verified number; texts stay off until they turn them on for a trip. */
export async function PUT(request: Request) {
  if (!textMessagingAvailable()) return phoneUnavailable();
  return messagingRoute(async () => {
    const result = await confirmPhoneCode(await request.json());
    return result.ok ? json({ status: "verified", phone: result.phone }) : refusal(result);
  });
}
