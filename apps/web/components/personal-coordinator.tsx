"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { PersonalCoordinatorCommandSchema, PersonalCoordinatorHistorySchema, PersonalCoordinatorTurnSchema, type PersonalCoordinatorTurn } from "@commons/contracts";
import { clearUnsentIfSent, readUnsent, writeUnsent } from "@/lib/coordinator-unsent";
import { isSendShortcut } from "@/lib/coordinator-client";
import { TripTasks, type TripTaskContext } from "./trip-tasks";
import { WorkspacePaneLayout, useRetainedScroll } from "./workspace-pane-layout";
import { ArrowUpIcon } from "./icons";

/** Presentation only; the layout stores nothing about the conversation. */
const DEFAULT_RATIO = 0.5;

export function PersonalCoordinator({slug,actorId,initialTurns,available,active,taskContext}:{slug:string;actorId:string;initialTurns:PersonalCoordinatorTurn[];available:boolean;active:boolean;taskContext?:TripTaskContext}) {
  const hasTasks=Boolean(taskContext);
  const [showTasks,setShowTasks]=useState(false);
  const [turns,setTurns]=useState(initialTurns),[text,setText]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const [fits,setFits]=useState(false),[ratio,setRatio]=useState(DEFAULT_RATIO);
  const input=useRef<HTMLTextAreaElement>(null),history=useRef<HTMLDivElement>(null),tasksScroll=useRef<HTMLDivElement>(null),tasksToggle=useRef<HTMLButtonElement>(null);
  const getTasksScroll=useCallback(()=>tasksScroll.current,[]);
  useRetainedScroll(getTasksScroll,showTasks);
  // Newest nearest the composer: keep the reader at the latest turn when history changes or the conversation becomes visible.
  useEffect(()=>{const element=history.current;if(element&&active)element.scrollTop=element.scrollHeight;},[turns,active]);
  const closeTasks=useCallback(()=>{setShowTasks(false);requestAnimationFrame(()=>tasksToggle.current?.focus());},[]);
  const key=`commons:${slug}:${actorId}:personal-command`,endpoint=`/api/v1/commons/${slug}/coordinator/personal`;
  useEffect(()=>{if(!active)return;const frame=requestAnimationFrame(()=>{setText(readUnsent(slug,actorId,"personal"));if(hasTasks && new URLSearchParams(window.location.search).get("todo"))setShowTasks(true);else input.current?.focus();});return()=>cancelAnimationFrame(frame);},[active,slug,actorId,hasTasks]);
  useEffect(()=>{
    if(!turns.some(turn=>turn.status === "pending"))return;
    const timer=window.setInterval(()=>{void fetch(endpoint,{cache:"no-store"}).then(async response=>{if(response.ok)setTurns(PersonalCoordinatorHistorySchema.parse((await response.json()).turns));}).catch(()=>undefined);},3000);
    return()=>window.clearInterval(timer);
  },[turns,endpoint]);
  async function send(retry?:PersonalCoordinatorTurn) {
    if(busy || !available || !retry && !text.trim())return;
    let command={commandId:retry?.commandId??crypto.randomUUID(),text:retry?.userText??text};
    try {const old=PersonalCoordinatorCommandSchema.safeParse(JSON.parse(window.sessionStorage.getItem(key)??"null"));if(!retry && old.success && old.data.text === text)command=old.data;window.sessionStorage.setItem(key,JSON.stringify(command));}catch{/* The typed draft stays in component state if storage fails. */}
    setBusy(true);setError("");
    try {
      const response=await fetch(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(command)});
      if(!response.ok){const body=await response.json();throw new Error(body.error??"Your question may be saved. Check your conversation before retrying.");}
      const turn=PersonalCoordinatorTurnSchema.parse((await response.json()).turn);
      setTurns(current=>[...current.filter(item=>item.commandId!==turn.commandId),turn].slice(-40));
      clearUnsentIfSent(slug,actorId,"personal",command.text);setText(current=>current===command.text?"":current);
      try{window.sessionStorage.removeItem(key);}catch{/* Recovery is still possible from saved history. */}
    }catch(cause){setError(cause instanceof Error?cause.message:"Your question may be saved. Check your conversation before retrying.");await fetch(endpoint,{cache:"no-store"}).then(async response=>{if(response.ok)setTurns(PersonalCoordinatorHistorySchema.parse((await response.json()).turns));}).catch(()=>undefined);}
    finally{setBusy(false);}
  }
  const tasks=taskContext?<div className="personal-coordinator__work">
    <header className="personal-coordinator__work-heading"><h3>Tasks</h3><button type="button" className="cm-action personal-coordinator__work-close" onClick={closeTasks}>{fits?"Close tasks":<><span aria-hidden="true">←</span> Back to conversation</>}</button></header>
    <div className="personal-coordinator__work-scroll" ref={tasksScroll} aria-label="Your tasks"><TripTasks slug={slug} actorId={actorId} context={taskContext}/></div>
  </div>:null;
  const conversation=<div className="personal-coordinator__chat">
    {/* eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard users must be able to scroll their history. */}
    <div className="personal-coordinator__history" ref={history} tabIndex={0} role="log" aria-label="Personal conversation history">
      <div className="personal-coordinator__column">
        {!turns.length?<p className="cm-note">Ask about the schedule, your stay, or your own travel details.</p>:null}
        {turns.map(turn=><article key={turn.id}><p><strong>You</strong></p><p className="personal-coordinator__text">{turn.userText}</p><p><strong>Commons</strong></p><p className="personal-coordinator__text">{turn.reply??(turn.status==="pending"?"Commons is working on your saved question.":"Commons could not finish this reply. Your question is saved.")}</p>{turn.status==="failed"?<button type="button" className="cm-action" disabled={busy||!available} onClick={()=>void send(turn)}>Try again</button>:null}</article>)}
      </div>
    </div>
    <form className="personal-coordinator__composer" onSubmit={event=>{event.preventDefault();void send();}}>
      <div className="personal-coordinator__column">
        {!available?<p className="cm-note">Conversation is unavailable here. You can still use Plan and Travel &amp; stays.</p>:null}
        {error?<p className="cm-note" role="alert">{error}</p>:null}
        <div className="personal-coordinator__input-bar">
          <textarea id="personal-coordinator-message" aria-label="Message Commons" aria-keyshortcuts="Meta+Enter Control+Enter" ref={input} rows={1} maxLength={1800} placeholder="Ask Commons about this trip…" value={text} onChange={event=>{setText(event.target.value);writeUnsent(slug,actorId,"personal",event.target.value);}} onKeyDown={event=>{if(isSendShortcut(event)){event.preventDefault();event.currentTarget.form?.requestSubmit();}}} />
          <button className="personal-coordinator__send" type="submit" aria-label="Send" title={busy?"Sending…":"Send message"} disabled={busy||!available||!text.trim()}><ArrowUpIcon /></button>
        </div>
      </div>
    </form>
  </div>;
  return <section className="personal-coordinator personal-coordinator--persistent" aria-label="Your personal Coordinator" data-tasks={showTasks?"open":"closed"}>
    <header className="personal-coordinator__header"><div><h2>Coordinator</h2><p>Just you · Commons answers from saved trip details. Nothing changes from chat.</p></div>{taskContext?<button ref={tasksToggle} type="button" className="workspace-icon-action personal-coordinator__tasks-toggle" aria-label="Tasks" title="Tasks" aria-pressed={showTasks} aria-controls="personal-coordinator-tasks" onClick={()=>showTasks?closeTasks():setShowTasks(true)}><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11" /><path d="m3.5 6 1.5 1.5L7.5 5M3.5 12l1.5 1.5L7.5 11M3.5 18l1.5 1.5 2.5-2.5" /></svg></button>:null}</header>
    <WorkspacePaneLayout work={tasks} conversation={conversation} workOpen={Boolean(taskContext)&&showTasks} expanded={false} ratio={ratio} onRatioChange={next=>setRatio(next)} onFitChange={setFits} workId="personal-coordinator-tasks" separatorLabel="Resize tasks and conversation"/>
  </section>;
}
