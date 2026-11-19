import type { ItineraryItem } from "@commons/contracts";

export type ActivityPollOption = { id: string; name: string; description: string | null };

/** Shared, uncancelled Plan activities requested for a poll, in plan order. Anything else (private, subgroup, other trip) is dropped. */
export function activityPollOptions(items: ItineraryItem[], requestedIds: string[], timezone: string): ActivityPollOption[] {
  const requested = new Set(requestedIds);
  const statusLabel = { idea: "Idea", planned: "Planned", confirmed: "Confirmed", cancelled: "Cancelled" } as const;
  const when = (item: ItineraryItem) => {
    try {
      if (item.startsAt) {
        const date = new Date(item.startsAt);
        return `${new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short", month: "short", day: "numeric" }).format(date)}, ${new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "numeric", minute: "2-digit" }).format(date)}`;
      }
      if (item.scheduledDate) return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric" }).format(new Date(`${item.scheduledDate}T12:00:00Z`));
    } catch { /* an unreadable time is left out rather than guessed */ }
    return null;
  };
  return items.filter(item => requested.has(item.id) && item.participantScope === "everyone" && item.status !== "cancelled")
    .sort((a, b) => (a.startsAt ?? a.scheduledDate ?? "9").localeCompare(b.startsAt ?? b.scheduledDate ?? "9"))
    .slice(0, 12)
    .map(item => {
      const cost = item.expectedCostCents && item.expectedCostCurrency
        ? `Estimated ${new Intl.NumberFormat("en-US", { style: "currency", currency: item.expectedCostCurrency }).format(item.expectedCostCents / 100)}${item.expectedCostBasis === "per_person" ? " each" : " total"}` : null;
      return { id: item.id, name: item.title.slice(0, 160), description: [when(item), item.location, statusLabel[item.status], cost].filter(Boolean).join(" · ").slice(0, 180) || null };
    });
}
