"use client";
import { useRef, useState } from "react";
import { PollWorkingDraftSchema, type PollWorkingDraft } from "@commons/contracts";
import { itineraryQuestion } from "@/lib/itinerary-workshop";
import { publicPollPath } from "@/lib/poll-route";
import { publishItineraryDraft, type ItineraryPublicationAttempt } from "@/lib/itinerary-publication-client";
import { ItineraryPublishConfirmation } from "./itinerary-publish-confirmation";
import { ItineraryShareDialog } from "./itinerary-share-dialog";

export function ItineraryOrganizerActions({ slug, draft, publicId, restricted, disabled, viewDisabled, proposalPending = false, privateDocument = false, onChanged, onReopened, onView, onBusy }: {
  slug: string; draft: PollWorkingDraft; publicId?: string; restricted?: boolean; disabled: boolean;
  proposalPending?: boolean; privateDocument?: boolean;
  viewDisabled?: boolean;
  onChanged: (pollId:string) => Promise<void>; onReopened:(draft:PollWorkingDraft)=>Promise<void>; onView: (results: boolean) => void;
  onBusy:(value:boolean)=>void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [access, setAccess] = useState<"invitees" | "link">("invitees");
  const [share, setShare] = useState<{url:string;access:"invitees"|"link"}|null>(null);
  const pending = useRef<ItineraryPublicationAttempt|null>(null);
  const question = itineraryQuestion(draft.data.questions)!;
  async function publish() {
    setBusy(true); onBusy(true); setError("");
    try {
      const poll = await publishItineraryDraft(slug, draft, access, pending);
      setConfirming(false);
      // Keep the selected draft mounted until its own goal has reloaded and
      // selection can move atomically to the published poll. A root reload
      // would drop goal drafts and close the share dialog after revisions.
      setShare({url:new URL(publicPollPath(poll.publicId),window.location.origin).href,access});
      pending.current = null;
      try { await onChanged(poll.id); } catch { setError("The itinerary is published. Refresh the conversation to see the saved poll."); }
    } catch (cause) {setError(cause instanceof Error ? cause.message : "Publication couldn’t complete.");}
    finally {setBusy(false);onBusy(false);}
  }
  async function revise() {
    setBusy(true); onBusy(true); setError("");
    try {
      const response = await fetch(`/api/v1/commons/${slug}/reviews/${draft.id}`, {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({action:"reopen",version:draft.version})});
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "The revision couldn’t start.");
      const saved = PollWorkingDraftSchema.parse(payload.draft);
      try { await onReopened(saved); } catch { setError("The revised draft is saved. Refresh the conversation to open it."); }
    } catch(cause) {setError(cause instanceof Error ? cause.message : "The revision couldn’t start.");}
    finally {setBusy(false);onBusy(false);}
  }
  return <section className="workspace-guide itinerary-organizer-actions" aria-label="Itinerary actions">
    <p>{draft.publishedPollId ? "Your itinerary poll is published. Review the group’s feedback here." : proposalPending ? "Apply or keep the current draft before sharing this itinerary poll." : "Share the saved itinerary when it is ready for the group."}</p>
    <div className="itinerary-actions"><button className="cm-action" disabled={(viewDisabled ?? disabled) || busy} onClick={()=>onView(false)}>Open itinerary</button>
      {draft.publishedPollId ? <><button className="cm-action" disabled={disabled || busy} onClick={()=>onView(true)}>Review the poll results</button>{publicId ? <button className="cm-action" disabled={disabled || busy} onClick={()=>setShare({url:new URL(publicPollPath(publicId),window.location.origin).href,access:restricted ? "invitees":"link"})}>Share with the group</button> : null}</> : <button className="cm-action cm-action--primary" disabled={disabled || busy || proposalPending || !question.itinerary.days.some(day=>day.items.length)} onClick={()=>setConfirming(true)}>Share with the group</button>}
    </div>
    {draft.publishedPollId ? privateDocument ? <p className="review-caption">Private edits stay private until you share them with the group.</p> : <details><summary>Revise the shared itinerary</summary><p>This closes the current poll and creates an editable version. Existing responses remain in the old results; everyone responds again after you publish the revision.</p><button className="cm-action" disabled={disabled || busy} onClick={()=>void revise()}>Start a revised itinerary</button></details> : null}
    {confirming ? <ItineraryPublishConfirmation title={draft.data.title} access={access} onAccess={setAccess} busy={busy} error={error} onClose={()=>setConfirming(false)} onPublish={()=>void publish()} /> : null}
    {error ? <p role="alert" className="form-error">{error}</p> : null}
    {share ? <ItineraryShareDialog data={draft.data} url={share.url} title={draft.data.title} access={share.access} onClose={()=>setShare(null)}/> : null}
  </section>;
}
