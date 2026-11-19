export type RawDigestActivity = {
  summary: string;
  occurredAt: string;
  action?: string;
  resourceType?: string;
  resourceId?: string;
};

export type DigestActivity = RawDigestActivity & {
  priority: number;
};

export type DigestExpense = {
  resourceId?: string;
  title: string;
  amountCents: number;
  currency: string;
  paidByName: string;
  addedAt: string;
};

type ChangeKind = "added" | "updated" | "removed" | "other";

function captured(summary: string, pattern: RegExp) {
  return summary.match(pattern)?.[1]?.trim().replace(/[.]$/, "");
}

function semanticSummary(activity: RawDigestActivity) {
  const { action = "", summary } = activity;
  const target = (...patterns: RegExp[]) => patterns
    .map((pattern) => captured(summary, pattern))
    .find(Boolean);

  switch (action) {
    case "commons.cover_updated": return "Trip cover changed.";
    case "commons.details_updated": return "Trip details changed.";
    case "commons.title_updated": return "Trip title changed.";
    case "commons.archived": return "Trip archived.";
    case "commons.restored": return "Trip restored.";
    case "budget.target_updated": return summary;
    case "stay.added": return `Stay added${target(/ added (.+) as a stay[.]?$/i) ? `: ${target(/ added (.+) as a stay[.]?$/i)}` : ""}.`;
    case "stay.updated": return `Stay updated${target(/ updated (.+)[.]?$/i) ? `: ${target(/ updated (.+)[.]?$/i)}` : ""}.`;
    case "stay.deleted": return `Stay removed${target(/ removed (.+) from the stays[.]?$/i) ? `: ${target(/ removed (.+) from the stays[.]?$/i)}` : ""}.`;
    case "itinerary.added": {
      const name = target(/ added (.+?)(?: as an idea)?[.]?$/i);
      return `Plan added${name ? `: ${name}` : ""}.`;
    }
    case "itinerary.imported": return "Plans imported after review.";
    case "itinerary.updated": return `Plan updated${target(/ updated (.+)[.]?$/i) ? `: ${target(/ updated (.+)[.]?$/i)}` : ""}.`;
    case "itinerary.deleted": return `Plan removed${target(/ deleted (.+)[.]?$/i) ? `: ${target(/ deleted (.+)[.]?$/i)}` : ""}.`;
    case "expense.updated": return `Expense updated${target(/ updated (.+)[.]?$/i) ? `: ${target(/ updated (.+)[.]?$/i)}` : ""}.`;
    case "expense.deleted": return `Expense removed${target(/ deleted (.+)[.]?$/i) ? `: ${target(/ deleted (.+)[.]?$/i)}` : ""}.`;
    case "travel_plan.sharing_updated": return "Travel details shared with the group.";
    case "poll.created": return summary.replace(/^Created poll:\s*/i, "Poll opened: ");
    case "poll.closed": return "Poll voting closed.";
    case "poll.reopened": return "Poll voting reopened.";
    case "proposal.approved": return `Plan approved${target(/ approved (.+?)(?: v\d+)?[.]?$/i) ? `: ${target(/ approved (.+?)(?: v\d+)?[.]?$/i)}` : ""}.`;
    case "proposal.revised": return `Plan corrected${target(/ corrected (.+?) as version \d+[.]?$/i) ? `: ${target(/ corrected (.+?) as version \d+[.]?$/i)}` : ""}.`;
    case "moment.added": return `Photo added${target(/ added (.+)[.]?$/i) ? `: ${target(/ added (.+)[.]?$/i)}` : ""}.`;
    case "moment.updated": return `Photo updated${target(/ updated (.+)[.]?$/i) ? `: ${target(/ updated (.+)[.]?$/i)}` : ""}.`;
    case "moment.deleted": return `Photo removed${target(/ deleted (.+)[.]?$/i) ? `: ${target(/ deleted (.+)[.]?$/i)}` : ""}.`;
    default: return summary;
  }
}

function changeKind(action = ""): ChangeKind {
  if (/\.(added|created|imported)$/.test(action)) return "added";
  if (/\.(deleted)$/.test(action)) return "removed";
  if (action === "stay.deleted") return "removed";
  if (/\.(updated|revised)$/.test(action) || action === "travel_plan.sharing_updated") return "updated";
  return "other";
}

export function digestActivityPriority(action = "") {
  if (/^(proposal|poll|itinerary|stay|travel_plan)\./.test(action)) return 1;
  if (/^(expense|expenses|reimbursement|budget)\./.test(action)) return 2;
  if (/^(membership|participant|participation|identity|invitation)\./.test(action)) return 3;
  if (/^commons\.(details|title|archived|restored)/.test(action)) return 4;
  if (/^moment\./.test(action)) return 5;
  if (action === "commons.cover_updated") return 6;
  return 4;
}

function resourceKey(activity: RawDigestActivity, index: number) {
  if (activity.resourceType === "commons") {
    return `${activity.resourceType}:${activity.resourceId ?? "trip"}:${activity.action ?? index}`;
  }
  return activity.resourceType && activity.resourceId
    ? `${activity.resourceType}:${activity.resourceId}`
    : `legacy:${activity.action ?? "activity"}:${semanticSummary(activity).toLocaleLowerCase()}`;
}

/** Reduces implementation-level writes into the shared outcomes people need to know. */
export function compactDigestActivities(activities: RawDigestActivity[]): DigestActivity[] {
  const byResource = new Map<string, { activity: RawDigestActivity; kind: ChangeKind }>();

  activities.forEach((activity, index) => {
    const key = resourceKey(activity, index);
    const nextKind = changeKind(activity.action);
    const previous = byResource.get(key);
    if (!previous) {
      byResource.set(key, { activity, kind: nextKind });
      return;
    }
    if (previous.kind === "added" && nextKind === "removed") {
      byResource.delete(key);
      return;
    }
    if (previous.kind === "added" && nextKind === "updated") {
      byResource.set(key, {
        activity: { ...activity, action: previous.activity.action, summary: previous.activity.summary },
        kind: "added",
      });
      return;
    }
    byResource.set(key, { activity, kind: nextKind });
  });

  const seen = new Set<string>();
  return [...byResource.values()]
    .map(({ activity }) => ({
      ...activity,
      summary: semanticSummary(activity),
      priority: digestActivityPriority(activity.action),
    }))
    .sort((a, b) => a.priority - b.priority || b.occurredAt.localeCompare(a.occurredAt))
    .filter((activity) => {
      const key = activity.summary.toLocaleLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Reconciles new expense cards with audit activity from the same digest window. */
export function compactDigestEvent(activities: RawDigestActivity[], expenses: DigestExpense[]) {
  const pendingExpenseIds = new Set(expenses.flatMap((expense) => expense.resourceId ? [expense.resourceId] : []));
  const deletedPendingExpenseIds = new Set(activities.flatMap((activity) => (
    activity.action === "expense.deleted" && activity.resourceId && pendingExpenseIds.has(activity.resourceId)
      ? [activity.resourceId]
      : []
  )));
  const compactedActivities = compactDigestActivities(activities.filter((activity) => !(
    activity.resourceId
    && pendingExpenseIds.has(activity.resourceId)
    && (activity.action === "expense.updated" || activity.action === "expense.deleted")
  )));
  const uniqueExpenses = new Map<string, DigestExpense>();
  for (const expense of expenses) {
    if (expense.resourceId && deletedPendingExpenseIds.has(expense.resourceId)) continue;
    const key = `${expense.title.toLocaleLowerCase()}|${expense.amountCents}|${expense.currency}|${expense.paidByName.toLocaleLowerCase()}`;
    uniqueExpenses.set(key, expense);
  }
  return { activities: compactedActivities, expenses: [...uniqueExpenses.values()] };
}
