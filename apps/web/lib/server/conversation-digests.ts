import {
  completeConversationDigest,
  leaseConversationDigest,
  queueConversationDigests,
  revalidateConversationDigest,
} from "@commons/database";
import { renderConversationDigestEmail } from "@/lib/email/conversation-digest-email";
import { EmailDeliveryError, sendEmail } from "@/lib/email/resend";
import { getSupabaseAuthUserEmail } from "@/lib/supabase/admin";

export async function queueDailyConversationDigests() {
  return queueConversationDigests();
}

export async function processConversationDigest(origin: string) {
  const digest = await leaseConversationDigest();
  if (!digest) return null;
  try {
    const recipientEmail = await getSupabaseAuthUserEmail(digest.payload.recipientAuthUserId);
    const payload = await revalidateConversationDigest(digest.id, digest.leaseAttempt);
    if (!payload) {
      await completeConversationDigest(digest.id, { leaseAttempt: digest.leaseAttempt, sent: false, errorCode: "recipient_unavailable" });
      return { id: digest.id, deliveryState: "cancelled" as const };
    }
    const rendered = renderConversationDigestEmail({
      payload,
      eventsUrl: `${origin}/trips`,
    });
    const result = await sendEmail({
      ...rendered,
      to: recipientEmail,
      idempotencyKey: `commons-conversation-digest-${digest.id}`,
    });
    await completeConversationDigest(digest.id, { sent: true, providerMessageId: result.id, leaseAttempt: digest.leaseAttempt });
    return { id: digest.id, deliveryState: "sent" as const };
  } catch (error) {
    const errorCode = error instanceof EmailDeliveryError ? error.code : "delivery_failed";
    await completeConversationDigest(digest.id, { sent: false, errorCode, leaseAttempt: digest.leaseAttempt });
    return { id: digest.id, deliveryState: "failed" as const, errorCode };
  }
}
