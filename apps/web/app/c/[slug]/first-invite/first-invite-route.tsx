"use client";

import { FirstInviteFlow, type FirstInviteDelivery } from "@/components/first-invite-flow";
import { commonsPath } from "@/lib/commons-route";

async function retryDelivery(slug: string, invitationId: string): Promise<FirstInviteDelivery["deliveryState"]> {
  const response = await fetch(`/api/v1/commons/${slug}/invitations/${invitationId}/send`, { method: "POST" });
  const payload = await response.json().catch(() => ({})) as { error?: string; delivery?: { deliveryState?: string } };
  if (!response.ok) throw new Error(payload.error ?? "That invitation wasn’t sent. Try again.");
  return payload.delivery?.deliveryState === "sent" ? "sent" : payload.delivery?.deliveryState === "queued" ? "queued" : "failed";
}

export function FirstInviteRoute({ draftId, tripId, slug, people, peopleWithoutEmail, checkout, forHelp = false }: { forHelp?: boolean; draftId: string; tripId: string; slug: string; people: string[]; peopleWithoutEmail: string[]; checkout: "returned" | "cancelled" | null }) {
  return <>
    <FirstInviteFlow
      draftId={draftId} tripSlug={slug} people={people} checkout={checkout} forHelp={forHelp}
      keepPlanning={{ label: "Keep planning", href: `${commonsPath(tripId)}?arrival=0` }}
      retryDelivery={retryDelivery}
      doneHref={() => `${commonsPath(tripId)}?arrival=0`}
      send={async () => {
        const response = await fetch(`/api/v1/event-creation-drafts/${draftId}/invite-saved`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trip: slug }) });
        const payload = await response.json().catch(() => ({})) as { error?: string; result?: { deliveries: FirstInviteDelivery[] } };
        if (!response.ok || !payload.result) throw new Error(payload.error ?? "Invitations weren’t sent. Your trip is saved. Try again.");
        return { deliveries: payload.result.deliveries, slug };
      }}
    />
    {peopleWithoutEmail.length ? <p className="first-invite-note">{peopleWithoutEmail.join(", ")} still need{peopleWithoutEmail.length === 1 ? "s" : ""} an email. Add them from People.</p> : null}
  </>;
}
