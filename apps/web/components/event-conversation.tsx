"use client";

import { useId, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import type { CommonsParticipant, CommonsState, CommonsSummary } from "@commons/contracts";
import { eventConversation } from "@/lib/event-conversation";
import { commonsPath } from "@/lib/commons-route";
import { ArrowUpIcon, CalendarIcon, ImageIcon, QuestionIcon } from "./icons";

export type EventConversationProps = {
  state: CommonsState; commons: CommonsSummary; participants: CommonsParticipant[]; currentActorId: string;
  draft: string; setDraft: (value: string) => void; send: () => Promise<boolean>;
  openActivity: (id: string) => void; openProposal: (id: string) => void; openMoments: () => void;
  participation: CommonsState["participation"]; respond: (id: string, choice: "in" | "maybe" | "skip") => Promise<void>;
  messageExtras?: (message: CommonsState["messages"][number]) => React.ReactNode;
  showOpenDecisions?: boolean;
  attendance?: React.ReactNode;
  /** Group messages are paused unless a trip turns them on: no composer, no message entries. Records stay. */
  messagesEnabled?: boolean;
};

export function OpenDecisions({ state, commons, openProposal }: Pick<EventConversationProps, "state" | "commons" | "openProposal">) {
  const unanswered = (state.pollRequests ?? []).filter(poll => poll.status === "open" && !poll.responded);
  const proposals = state.proposals.filter(proposal => proposal.status === "proposed");
  if (!unanswered.length && !proposals.length) return null;
  return <section className="conversation-pinned" aria-label="Open decisions">
    <h3>Open decisions</h3>
    {unanswered.map(poll => <Link key={poll.id} href={poll.canManage ? `${commonsPath(commons.id)}/polls/${poll.id}` : `/c/poll/${poll.publicId}`}><span>{poll.title}</span><small>Answer poll</small></Link>)}
    {proposals.map(proposal => <button key={proposal.id} onClick={() => openProposal(proposal.id)}><span>{proposal.title}</span><small>Review proposal · Approval required</small></button>)}
  </section>;
}

export function EventConversation({ state, commons, participants, currentActorId, draft, setDraft, send, openActivity, openProposal, openMoments, participation, respond, messageExtras, showOpenDecisions = true, attendance, messagesEnabled = false }: EventConversationProps) {
  const [expanded, setExpanded] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  const responsePending = useRef(false);
  const [responding, setResponding] = useState(false);
  const id = useId();
  const entries = eventConversation(state, { includeMessages: messagesEnabled }).reverse();
  const polls = state.pollRequests ?? [];
  const actor = participants.find(person => person.id === currentActorId)?.displayName ?? "you";
  const formatTime = (at: string) => new Intl.DateTimeFormat("en-US", { timeZone: commons.timezone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(at));
  const pollUrl = (poll: (typeof polls)[number]) => poll.canManage ? `${commonsPath(commons.id)}/polls/${poll.id}` : `/c/poll/${poll.publicId}`;
  async function submit() {
    if (!draft.trim() || pending.current) return;
    pending.current = true; setSending(true); setError("");
    try { if (!await send()) setError("Message not sent. Your draft is still here. Try again."); }
    catch { setError("Message not sent. Your draft is still here. Try again."); }
    finally { pending.current = false; setSending(false); }
  }
  async function saveResponse(itemId: string, choice: "in" | "maybe" | "skip") {
    if (responsePending.current) return;
    responsePending.current = true; setResponding(true); setError("");
    try { await respond(itemId, choice); }
    catch { setError("Response not saved. Try again."); }
    finally { responsePending.current = false; setResponding(false); }
  }
  return <div className="event-conversation">
    {messagesEnabled ? <>
      <form className="conversation-composer" onSubmit={event => { event.preventDefault(); void submit(); }}>
        <label className="sr-only" htmlFor={id}>Message the group</label>
        <textarea id={id} rows={2} value={draft} maxLength={4000} disabled={sending} onChange={event => setDraft(event.target.value)} placeholder="Message the group" />
        <button type="submit" aria-label={sending ? "Sending message" : "Send message"} disabled={sending || !draft.trim()}><ArrowUpIcon /></button>
      </form>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <p className="composer-note">Shared with the group · Sending as {actor}</p>
    </> : error ? <p className="form-error" role="alert">{error}</p> : null}
    {/* Keyboard users need to focus this desktop scroll region to scroll its history. */}
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex */}
    <div className="conversation-history" role="region" aria-label={messagesEnabled ? "Conversation history" : "Decisions and updates history"} tabIndex={0}>
    {showOpenDecisions ? <OpenDecisions state={state} commons={commons} openProposal={openProposal} /> : null}
    <div className="conversation-records">
      {attendance}
      {(expanded ? entries : entries.slice(0, 12)).map(entry => {
        if (entry.kind === "message") return <article key={entry.id} className={`conversation-message${entry.message.actorId === currentActorId ? " conversation-message--mine" : ""}`}>
          <header><strong>{entry.message.actorName}</strong><time dateTime={entry.at}>{formatTime(entry.at)}</time></header>
          <p>{entry.message.body}</p>
          {entry.message.actorType === "commons" && /\b(?:Moments|Photos)\b/.test(entry.message.body) ? <button className="view-secondary-action conversation-action" onClick={openMoments}><ImageIcon /> Open Photos</button> : null}
          {messageExtras?.(entry.message)}
          {entry.message.attachments?.length ? <div className="conversation-photos">{entry.message.attachments.map(photo => <button key={photo.assetUrl} onClick={openMoments} aria-label={`Open ${photo.caption ?? "photo"} in Photos`}><Image src={photo.assetUrl} alt={photo.altText} width={180} height={120} unoptimized /></button>)}</div> : null}
        </article>;
        if (entry.kind === "removed") return <p className="conversation-notice" key={entry.id}>An activity was removed from Plan. <time dateTime={entry.at}>{formatTime(entry.at)}</time></p>;
        if (entry.kind === "proposal") return <article className="conversation-record" key={entry.id}><small>Decision · {entry.proposal.status}</small><strong>{entry.proposal.title}</strong><p>{entry.proposal.summary}</p><button className="view-secondary-action conversation-action" onClick={() => openProposal(entry.proposal.id)}><QuestionIcon /> View decision</button></article>;
        const item = entry.activity;
        const included = [...new Set([...(item.participantIds ?? []), ...(item.expectedParticipantIds ?? [])])].map(personId => participants.find(person => person.id === personId)?.displayName).filter(Boolean);
        return <article className="conversation-record" key={entry.id} data-activity-id={item.id}>
          <small>{item.status === "cancelled" ? "Activity cancelled" : entry.changed ? "Plan updated" : item.status === "idea" ? "Idea" : "In the plan"}{entry.at ? ` · ${formatTime(entry.at)}` : ""}</small>
          <strong>{item.title}</strong><p>{item.startsAt ? formatTime(item.startsAt) : "No day set"}{item.location ? ` · ${item.location}` : ""}</p>
          <p>{item.participantScope === "everyone" ? "Everyone included" : included.length ? `Included: ${included.join(", ")}` : "Whoever wants to join"}</p>
          <small>{item.provenanceLabel}</small>
          <button className="view-secondary-action conversation-action" onClick={() => openActivity(item.id)}><CalendarIcon /> View in Plan</button>
          {item.status !== "cancelled" ? <div className="conversation-responses" role="group" aria-label={`Your response to ${item.title}`}>{([['in', 'I’m in'], ['maybe', 'Maybe'], ['skip', 'Skip']] as const).map(([value, label]) => <button key={value} disabled={responding} aria-pressed={participation[item.id] === value} onClick={() => void saveResponse(item.id, value)}>{label}</button>)}</div> : null}
        </article>;
      })}
      {polls.filter(poll => poll.responded || poll.status === "closed").map(poll => <Link className="conversation-record" key={poll.id} href={pollUrl(poll)}><small>{poll.status === "closed" ? "Poll closed" : "Your response is saved"}</small><strong>{poll.title}</strong><span>View poll</span></Link>)}
      {!entries.length && !polls.length ? <p className="home-feed-empty">{messagesEnabled ? "No conversation yet. Start with a message." : "Nothing to react to yet."}</p> : null}
    </div>

    {entries.length > 12 && !expanded ? <button className="text-action" onClick={() => setExpanded(true)}>Show earlier conversation ({entries.length - 12})</button> : null}
    </div>
  </div>;
}
