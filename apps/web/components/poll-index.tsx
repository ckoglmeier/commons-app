import Link from "next/link";
import type { PollWorkingDraft } from "@commons/contracts";
import { PlusIcon } from "./icons";

export function PollIndex({ slug, drafts, polls }: {
  slug: string; drafts: PollWorkingDraft[];
  polls: Array<{ id: string; publicId: string; title: string; canManage: boolean; status: string; responded: boolean }>;
}) {
  return <div className="poll-organizer-content poll-index-content">
    <div className="poll-organizer-intro poll-page-heading"><h1>Polls</h1><Link className="cm-action cm-action--primary" href={`/c/${slug}/polls/new`}><PlusIcon />Start a poll</Link></div>
    {!drafts.length && !polls.length ? <section className="poll-index-empty"><h2>What needs deciding?</h2><p>Ask about dates, places, or anything the group needs to work out.</p></section> : <>
      {drafts.length ? <section><h2>Your drafts</h2><p>Private until you publish.</p><div className="poll-index-list">{drafts.map(draft => <Link key={draft.id} href={`/c/${slug}/polls/new?draft=${draft.id}`}><strong>{draft.data.title || "Untitled poll"}</strong><small>{draft.data.sourcePollId ? "Follow-up poll · " : ""}Continue editing</small></Link>)}</div></section> : null}
      {polls.length ? <section><h2>Shared polls</h2><div className="poll-index-list">{polls.map(poll => <Link key={poll.id} href={poll.canManage ? `/c/${slug}/polls/${poll.id}` : `/c/poll/${poll.publicId}`}><strong>{poll.title}</strong><small>{poll.status === "closed" ? "Voting closed · View outcome" : poll.responded ? "Response saved · Review or revise" : "Help shape this trip"}</small></Link>)}</div></section> : null}
    </>}
  </div>;
}
