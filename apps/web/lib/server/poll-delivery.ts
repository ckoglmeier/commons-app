import "server-only";
import { completePollDelivery, leasePollDelivery, revalidatePollDelivery } from "@commons/database";
import { sendEmail } from "@/lib/email/resend";
import { runPollDelivery } from "./poll-delivery-worker";
import { requireCommonsDatabaseUrl } from "./runtime-environment";
import { getSupabaseVerifiedAuthUserEmail } from "@/lib/supabase/admin";
import { isSupabaseAuthConfigured } from "@/lib/supabase/config";

export async function processPollDelivery(origin: string, pollId?: string) {
  const url = requireCommonsDatabaseUrl();
  const resolveVerifiedEmail = isSupabaseAuthConfigured() ? getSupabaseVerifiedAuthUserEmail : undefined;
  return runPollDelivery(origin, {
    lease: () => leasePollDelivery(url, pollId, resolveVerifiedEmail),
    revalidate: (id, attempt) => revalidatePollDelivery(id, attempt, url, resolveVerifiedEmail),
    complete: (id, attempt, result) => completePollDelivery(id, attempt, result, url),
    send: sendEmail,
  });
}

export async function drainPollDeliveries(origin: string, pollId?: string) {
  const results = [];
  const deadline = Date.now() + 35_000;
  for (let count = 0; count < 200 && Date.now() < deadline; count += 1) {
    const result = await processPollDelivery(origin, pollId);
    if (!result) break;
    results.push(result);
  }
  return results;
}
