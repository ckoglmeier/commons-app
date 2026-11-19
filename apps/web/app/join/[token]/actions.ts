"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@supabase/supabase-js";
import { getInvitationEntryContext, queueInvitationEntryRecovery } from "@commons/database";
import { getSupabaseAuthConfig } from "@/lib/supabase/config";
import { createSupabaseServerClient, getCommonsAuthIdentity } from "@/lib/supabase/server";
import { commonsSiteOrigin, requireCommonsDatabaseUrl } from "@/lib/server/runtime-environment";
import { processInvitationDelivery } from "@/lib/server/commons";
import { redeemInvitationEmail } from "@/lib/invitation-entry-flow";

export type InvitationEntryState = { error?: string; sent?: boolean; expired?: boolean };

export async function continueInvitationEmail(_previous: InvitationEntryState, data: FormData): Promise<InvitationEntryState> {
  const token = String(data.get("token") ?? "");
  if (!token || token.length > 256) return { error: "Invitation unavailable." };
  let destination: string | undefined;
  try {
    const result = await redeemInvitationEmail({ token, entry: String(data.get("entry") ?? ""),
      poll: String(data.get("poll") ?? ""), expectedCurrentAccountId: String(data.get("currentAccountId") ?? ""),
    }, {
      context: () => getInvitationEntryContext(token, requireCommonsDatabaseUrl()),
      currentAccount: getCommonsAuthIdentity,
      verify: async proof => {
        const { url, publishableKey } = getSupabaseAuthConfig();
        // Isolated client: a rejected/mismatched proof must never replace the current browser session.
        const auth = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
        const { data: result, error } = await auth.auth.verifyOtp({ token_hash: proof.tokenHash, type: proof.type });
        if (error || !result.user?.email || !result.session) return null;
        return { authUserId: result.user.id, email: result.user.email, metadata: result.user.user_metadata,
          access_token: result.session.access_token, refresh_token: result.session.refresh_token };
      },
      establishSession: async verified => {
        const auth = await createSupabaseServerClient();
        const { error } = await auth.auth.setSession(verified);
        if (error) throw new Error("Session not established.");
      },
    });
    if (result.error === "account_changed") return { error: "Your signed-in account changed. Refresh this page before continuing." };
    if (result.error) return { expired: true, error: "The sign-in link expired or was already used. Your invitation is still here." };
    destination = result.destination;
  } catch { return { error: "Sign-in could not finish. Try again." }; }
  if (destination) redirect(destination);
  return { error: "Sign-in could not finish. Try again." };
}

export async function sendInvitationEntryEmail(_previous: InvitationEntryState, data: FormData): Promise<InvitationEntryState> {
  const token = String(data.get("token") ?? "");
  if (!token || token.length > 256) return { error: "Invitation unavailable." };
  try {
    const url = requireCommonsDatabaseUrl();
    if (!await getInvitationEntryContext(token, url)) return { error: "This invitation is no longer available." };
    const queued = await queueInvitationEntryRecovery(token, String(data.get("poll") ?? "") || null, url);
    if (queued.status === "limited") return { error: "A link was requested recently. Check your inbox, or try again later." };
    const origin = commonsSiteOrigin((await headers()).get("origin") ?? undefined);
    const result = await processInvitationDelivery(queued.deliveryAttemptId, origin);
    return result?.deliveryState === "sent" ? { sent: true } : { error: "Email not sent yet. Delivery will retry; you can try again later." };
  } catch { return { error: "Email not sent. Try again later." }; }
}
