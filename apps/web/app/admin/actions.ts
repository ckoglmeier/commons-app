"use server";

import { revalidatePath } from "next/cache";
import {
  retryConversationDigest,
  retryOperatorApprovalNotice,
  retryOperatorFeeExpense,
  resolveOperatorRefundHold,
  sendOperatorBetaInvite,
  revokeOperatorBetaInvite,
  retryOperatorInvitation,
  setOperatorCreationAccess,
  requireCommonsOperator,
} from "@/lib/server/operator";
import { commonsSiteOrigin } from "@/lib/server/runtime-environment";
import { readCommonsRuntimeEnvironment } from "@/lib/server/runtime-environment";
import { runWritingSmoke } from "@/lib/server/writing-smoke";
import { betaInviteErrorMessage } from "@/lib/email/beta-invite-error";

export async function inviteBetaOrganizer(_previous: { message: string; error: boolean }, formData: FormData) {
  try {
    const message = await sendOperatorBetaInvite(String(formData.get("email") ?? ""), String(formData.get("message") ?? ""));
    revalidatePath("/admin");
    return { message, error: false };
  } catch (error) {
    return { message: betaInviteErrorMessage(error), error: true };
  }
}

export async function revokeBetaInvite(formData: FormData) {
  await revokeOperatorBetaInvite(String(formData.get("inviteId") ?? ""));
  revalidatePath("/admin");
}

export async function approveCreationAccess(formData: FormData) {
  const personId = String(formData.get("personId") ?? "");
  const requesterEmail = String(formData.get("requesterEmail") ?? "") || undefined;
  if (!personId) return;
  await setOperatorCreationAccess(personId, "approved", "Approved from pilot admin", requesterEmail);
  revalidatePath("/admin");
}

export async function revokeCreationAccess(formData: FormData) {
  const personId = String(formData.get("personId") ?? "");
  if (!personId) return;
  await setOperatorCreationAccess(personId, "revoked", "Revoked from pilot admin");
  revalidatePath("/admin");
}

export async function retryInvitation(formData: FormData) {
  const invitationId = String(formData.get("invitationId") ?? "");
  if (!invitationId) return;
  const origin = commonsSiteOrigin();
  await retryOperatorInvitation(invitationId, origin, "Retried from pilot admin");
  revalidatePath("/admin");
}

export async function retryDailyEmail(formData: FormData) {
  const deliveryId = String(formData.get("deliveryId") ?? "");
  if (!deliveryId) return;
  await retryConversationDigest(deliveryId, "Retried from pilot admin");
  revalidatePath("/admin");
}

export async function runPrivateWritingSmoke() {
  try {
    await requireCommonsOperator();
    const environment = readCommonsRuntimeEnvironment();
    const result = await runWritingSmoke({ apiKey: environment.OPENROUTER_API_KEY, baseline: environment.COMMONS_WORKSPACE_MODEL });
    return { error: false, message: "Blind comparison complete. Score each A/B pair before revealing the model labels.", ...result };
  } catch {
    return { error: true, message: "The writing comparison could not be completed. No Commons data changed.", results: [], models: null };
  }
}

export async function retryApprovalNotice(formData: FormData) {
  await retryOperatorApprovalNotice(String(formData.get("personId") ?? ""));
  revalidatePath("/admin");
}

export async function resolveRefundHold(formData: FormData) {
  await resolveOperatorRefundHold(String(formData.get("draftId") ?? ""), String(formData.get("reason") ?? ""));
  revalidatePath("/admin/payments");
}

export async function retryFeeExpense(formData: FormData) {
  await retryOperatorFeeExpense(String(formData.get("draftId") ?? ""));
  revalidatePath("/admin/payments");
}
