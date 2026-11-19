"use client";
import { useEffect, useRef, useState } from "react";
import type { BrainFinding } from "@commons/contracts";
import { requestJson } from "@/lib/coordinator-client";
type BrainState = {settings:{optedIn:boolean;paused:boolean;entitled:boolean;budgetConfigured:boolean};lastReview:{at:string;status:string;error:string|null}|null;coverage:string[];recommendations:Array<{id:string;snapshotHash:string;finding:BrainFinding;goalId:string|null;todoId:string|null}>};
export function CoordinatorBrain({slug,enabled,onTask,onTodo}:{slug:string;enabled:boolean;onTask:(goalId:string)=>void;onTodo:()=>void}) {
  const [state,setState]=useState<BrainState|null>(null),[error,setError]=useState(""),[pending,setPending]=useState(false),[notice,setNotice]=useState("");
  const commands=useRef(new Map<string,string>()),endpoint=`/api/v1/commons/${slug}/coordinator/brain`;
  useEffect(()=>{if(!enabled)return;let active=true;const refresh=()=>{void requestJson<BrainState>(endpoint,{cache:"no-store"}).then(value=>{if(active)setState(value);}).catch(()=>{if(active)setError("Trip review couldn’t refresh.");});};refresh();const timer=window.setInterval(refresh,15000);window.addEventListener("focus",refresh);window.addEventListener("commons:trip-tasks-changed",refresh);return()=>{active=false;window.clearInterval(timer);window.removeEventListener("focus",refresh);window.removeEventListener("commons:trip-tasks-changed",refresh);};},[endpoint,enabled]);
  async function operate(input:Record<string,unknown>) {
    setPending(true);setError("");setNotice("");const fingerprint=JSON.stringify(input),key=`commons:${slug}:brain-command`;
    let commandId=commands.current.get(fingerprint)??crypto.randomUUID();
    try {const stored=JSON.parse(sessionStorage.getItem(key)??"null");if(stored?.fingerprint===fingerprint)commandId=stored.commandId;sessionStorage.setItem(key,JSON.stringify({fingerprint,commandId}));}catch{/* Keep the in-memory retry. */}
    commands.current.set(fingerprint,commandId);
    try {
      const result=await requestJson<{goalId?:string;todoId?:string;dispatched?:boolean;published?:boolean;reason?:string;findings?:number}>(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...input,commandId})});
      commands.current.delete(fingerprint);try{sessionStorage.removeItem(key);}catch{/* The receipt is saved. */}
      if(input.op === "review") {
        const reasons:Record<string,string>={daily_cap:"This trip was reviewed recently. New checks will wait until the review allowance resets.",not_due:"This trip isn’t due for another review yet.",unchanged:"Saved trip details haven’t changed since the last completed review.",running:"A trip review is already running.",paused:"Review is paused.",not_opted_in:"Opt in before reviewing this trip.",entitlement:"Trip review isn’t available for this trip.",budget_missing:"Trip review needs a configured allowance.",budget_exhausted:"This trip’s review allowance is used up.",trip_ended:"This trip has ended; no new reminders were added."};
        setNotice(result.published === true ? result.findings ? "Review complete. Check Tasks for current to-dos." : "Review complete. No new gaps found." : result.reason ? reasons[result.reason] ?? "The review couldn’t finish. No new to-dos were added." : "The review couldn’t finish. Try again.");
      }
      window.dispatchEvent(new Event("commons:trip-tasks-changed"));
      if(result.goalId)onTask(result.goalId);else if(result.todoId)onTodo();
      setState(await requestJson<BrainState>(endpoint,{cache:"no-store"}));
    }catch(cause){setError(cause instanceof Error?cause.message:"Trip review couldn’t save. Try again.");}finally{setPending(false);}
  }
  if(!enabled||!state)return null;
  return <section aria-label="Trip review" className="workspace-brain"><details><summary>Trip review{state.lastReview?` · ${state.lastReview.status === "completed"?"Reviewed":"Needs attention"}`:""}</summary>
    <p className="review-caption">Looks for gaps in saved trip details and adds simple to-dos. It doesn’t run actions or update Plan.</p>
    <p className="review-caption">{!state.settings.entitled||!state.settings.budgetConfigured?"Recurring review is unavailable until entitlement, budget and an operational runner are configured.":state.settings.paused?"Review is paused.":"Saved-fact checks are available. Recurring review requires an operational worker."}</p>
    <div className="workspace-actions"><button type="button" className="cm-action" disabled={pending} onClick={()=>void operate({op:"settings",optedIn:!state.settings.optedIn,paused:state.settings.optedIn})}>{state.settings.optedIn?"Opt out of review":"Opt in to review"}</button>{state.settings.optedIn?<button type="button" className="cm-action" disabled={pending} onClick={()=>void operate({op:"settings",optedIn:true,paused:!state.settings.paused})}>{state.settings.paused?"Resume review":"Pause review"}</button>:null}<button type="button" className="cm-action" disabled={pending||!state.settings.entitled||!state.settings.budgetConfigured||state.settings.paused||!state.settings.optedIn} onClick={()=>void operate({op:"review"})}>Review trip</button></div>
    {state.lastReview?<p className="review-caption">Last review: <time dateTime={state.lastReview.at}>{new Date(state.lastReview.at).toLocaleString("en-US",{hour12:true})}</time>{state.lastReview.error?" · Could not produce a current review.":""}</p>:null}
    {state.recommendations.map(r=><div key={r.id}><p><strong>{r.finding.title}</strong></p><p className="review-caption">{r.finding.detail}</p><div className="workspace-actions"><button type="button" className="cm-action" disabled={pending} onClick={()=>{if(r.goalId)onTask(r.goalId);else if(r.todoId)onTodo();else void operate({recommendationId:r.id,expectedSnapshot:r.snapshotHash,action:"accept"});}}>{r.goalId?"Open earlier task":r.todoId?"View to-do":"Add to-do"}</button><button type="button" className="cm-action" disabled={pending} onClick={()=>void operate({recommendationId:r.id,expectedSnapshot:r.snapshotHash,action:"snooze"})}>Not now</button><button type="button" className="cm-action" disabled={pending} onClick={()=>void operate({recommendationId:r.id,expectedSnapshot:r.snapshotHash,action:"dismiss"})}>Dismiss suggestion</button></div><details><summary>Saved evidence</summary>{r.finding.evidence.map(ref=><p className="review-caption" key={ref.id}>Evidence version {ref.version}</p>)}</details></div>)}
    <details><summary>Review coverage</summary>{state.coverage.map(text=><p className="review-caption" key={text}>{text}</p>)}</details>
  </details>{notice?<p role="status" className="review-caption">{notice}</p>:null}{error?<p role="alert" className="cm-note">{error}</p>:null}</section>;
}
