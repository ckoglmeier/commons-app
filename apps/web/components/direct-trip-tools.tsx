import Link from "next/link";
import type { CoordinatorGoal } from "@commons/contracts";

/** Existing permission-scoped goal records, presented as the group's open questions. */
export function DirectTripTools({ slug, goals }: { slug: string; goals: CoordinatorGoal[] }) {
  const open = goals.filter(goal => !["completed", "cancelled", "failed"].includes(goal.lifecycle));
  const base = `/c/${encodeURIComponent(slug)}`;
  return <section className="direct-trip-tools" aria-label="Open questions">
    <h3>Open questions</h3>
    {open.length ? <ul>{open.slice(0, 3).map(goal => <li key={goal.goalId}><Link href={`${base}/goals/${encodeURIComponent(goal.goalId)}`}>{goal.title}</Link></li>)}</ul> : <p>No open questions.</p>}
    {goals.length > 0 ? <Link className="cm-action" href={`${base}/goals`}>{open.length > 3 ? `View all questions (${open.length} open)` : "Questions and decisions"}</Link> : null}
  </section>;
}
