"use server";

import { revalidatePath } from "next/cache";
import { changeTripUsageControl, markOperatorItem, retryOperatorItem, retryOperatorMessage } from "@/lib/server/beta-completion";

const KINDS = ["partner_inquiry", "notification", "intake"] as const;
const USAGE = ["sms_segment", "extraction_call", "model_call", "map_lookup", "payment_fee"] as const;
type Kind = (typeof KINDS)[number];

function itemFrom(formData: FormData) {
  const kind = String(formData.get("kind") ?? "") as Kind;
  const id = String(formData.get("id") ?? "").slice(0, 80);
  return KINDS.includes(kind) && id ? { kind, id } : null;
}

/** Marks an item reviewed (someone looked), resolved (fixed or closed) or reopened. Each is an append-only, attributed operator action. */
export async function markFailure(formData: FormData) {
  const item = itemFrom(formData);
  const action = String(formData.get("action") ?? "");
  if (!item || !["reviewed", "resolved", "reopened"].includes(action)) return;
  await markOperatorItem({ ...item, action: action as "reviewed" | "resolved" | "reopened", note: String(formData.get("note") ?? "").slice(0, 300) || undefined });
  revalidatePath("/admin/beta");
}

/** Safe retry: only items that were not delivered, and only those that can be retried without private content. */
export async function retryFailure(formData: FormData) {
  const item = itemFrom(formData);
  if (!item || item.kind === "intake") return;
  await retryOperatorItem({ kind: item.kind, id: item.id });
  revalidatePath("/admin/beta");
}

export async function retryMessage(formData: FormData) {
  const id = String(formData.get("id") ?? "").slice(0, 100);
  if (!id) return;
  await retryOperatorMessage(id, { checkedProvider: formData.get("checkedProvider") === "yes" });
  revalidatePath("/admin/beta");
}

export async function saveUsageControl(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().slice(0, 120);
  const kind = String(formData.get("kind") ?? "") as (typeof USAGE)[number];
  if (!slug || !USAGE.includes(kind)) return;
  const raw = String(formData.get("limit") ?? "").trim();
  const limitUnits = raw === "" ? null : Number(raw);
  if (limitUnits !== null && !Number.isInteger(limitUnits)) return;
  await changeTripUsageControl(slug, kind, { limitUnits, disabled: formData.get("disabled") === "on" });
  revalidatePath("/admin/beta");
}
