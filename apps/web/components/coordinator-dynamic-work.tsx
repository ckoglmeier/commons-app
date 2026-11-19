'use client';
import { useEffect, useState } from 'react';
import type { CoordinatorPresentation, CoordinatorUiBlock } from '@commons/contracts';
import { presentationBlocks, presentationIsCurrent, type PresentationCatalog } from '../lib/coordinator-presentation';
import { compareStaysPollPath, type StayComparisonDraft, type StayComparisonFocus } from '../lib/compare-stays';
import { ComparedStayRow, ComparisonContext } from './compare-stays-option';
import { researchRunView } from './coordinator-turn-parts';
import type { CoordinatorThread } from '@commons/contracts';



type Choices = { ids: string[]; focus: StayComparisonFocus | ''; revision: string };
export function CoordinatorDynamicWork({ presentation, catalog, actorId, turnId, thread, onOpenArtifact, onBack }: {
  presentation: CoordinatorPresentation; catalog: PresentationCatalog; actorId: string; turnId: string; thread: CoordinatorThread;
  onOpenArtifact: (selection: string) => void; onBack: () => void;
}) {
  const key=`commons:${catalog.tripId}:${actorId}:${catalog.threadId}:dynamic-work:v1`;
  const [choices,setChoices]=useState<Choices>({ids:[],focus:'',revision:catalog.comparison.revision});
  const [ready,setReady]=useState(false),[storageError,setStorageError]=useState(false);
  useEffect(()=>{let recovered:Choices={ids:[],focus:'',revision:catalog.comparison.revision},failed=false;
    try{const raw=JSON.parse(sessionStorage.getItem(key)??'null');if(raw&&Array.isArray(raw.ids)&&typeof raw.revision==='string')recovered={ids:[...new Set(raw.ids.filter((id:unknown):id is string=>typeof id==='string'&&catalog.comparison.options.some(s=>s.id===id)))].slice(0,24) as string[],revision:raw.revision,focus:['overview','price','location','notes'].includes(raw.focus)?raw.focus:''};}catch{failed=true;}
    const frame=requestAnimationFrame(()=>{setChoices(recovered);setReady(true);setStorageError(failed);});return()=>cancelAnimationFrame(frame);
    // Model layout updates preserve the person's choices. A new actor/thread gets its own session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[key]);
  const update=(value:Choices)=>{setChoices(value);try{sessionStorage.setItem(key,JSON.stringify(value));setStorageError(false);}catch{setStorageError(true);}};
  const current=presentationIsCurrent(presentation,catalog,turnId);
  const staleChoices=choices.revision!==catalog.comparison.revision;
  const selected=choices.ids.filter(id=>catalog.comparison.options.some(s=>s.id===id));
  const pollDraft:StayComparisonDraft={revision:choices.revision,selectedIds:selected,focus:choices.focus||'overview'};
  const path=current&&ready&&!staleChoices?compareStaysPollPath(catalog.comparison,pollDraft):null;
  const leaf=(node:CoordinatorUiBlock)=>{
    if(node.component==='OpenQuestions')return <section key="questions" className="workspace-work-section" aria-label="Open questions"><h3>Still to clarify</h3><p className="review-caption">Earlier discussion in this conversation, not approved decisions.</p><ul>{node.props.ids.map(id=><li key={id}>{catalog.questions.find(q=>q.id===id)!.text}</li>)}</ul></section>;
    if(node.component==='Artifact'){
      const artifact=catalog.artifacts.find(a=>a.id===node.props.id)!;
      if(artifact.kind==='research'){
        const turn=thread.turns.find(t=>t.id===artifact.recordId),run=thread.researchRuns.find(r=>r.id===artifact.recordId);
        const research=turn?.workspace?.research??run;return research?<div key={artifact.id}>{researchRunView(research,artifact.id,'Saved in this conversation')}</div>:null;
      }
      return <section key={artifact.id} className="workspace-work-section"><h3>{artifact.title}</h3><p className="review-caption">Private {artifact.kind==='itinerary'?'itinerary':'poll'} draft · Version {artifact.version}</p><button type="button" className="cm-action" onClick={()=>onOpenArtifact(artifact.selection)}>Open {artifact.kind==='itinerary'?'itinerary':'poll'} draft</button></section>;
    }
    const snapshot={...catalog.comparison,options:node.props.ids.map(id=>catalog.comparison.options.find(s=>s.id===id)!)};
    return <section key="stays" className="dynamic-work-stays"><h3>Saved stay options</h3><p className="review-caption">Prices as entered. Dates, currencies and included people may differ. Distances are straight-line.</p><label className="compare-stays-focus">Reading order<select disabled={!ready} value={choices.focus} onChange={e=>update({...choices,focus:e.target.value as Choices['focus']})}><option value="">Suggested order</option><option value="overview">The whole picture</option><option value="price">Price first</option><option value="location">Location first</option><option value="notes">Rooms, needs and notes first</option></select></label>
      <ComparisonContext.Provider value={{snapshot,selectedIds:selected,disabled:!ready||staleChoices,select:(id,included)=>update({...choices,ids:included?[...new Set([...choices.ids,id])]:choices.ids.filter(s=>s!==id)})}}><ul className="compare-stays-options">{snapshot.options.map(option=><ComparedStayRow key={option.id} id={option.id} focus={choices.focus||node.props.focus}/>)}</ul></ComparisonContext.Provider></section>;
  };
  return <section className="coordinator-dynamic-work compare-stays" aria-label="Suggested working view" data-coordinator-presentation-turn={presentation.turnId}>
    <p className="review-caption">Suggested view · Saved trip details and this conversation</p>
    <button className="cm-action cm-action--quiet" type="button" onClick={onBack}>Back to other working material</button>
    {!current?<p role="status">{presentation.status==='unavailable'?'The suggested view could not be loaded.':'The saved details changed. Ask Commons for an updated view.'} Your conversation and drafts are still available.</p>:<>
      {presentation.view!.props.children.map((node,index)=>node.component==='Section'?<section className="workspace-work-section" key={index}><h3>{node.props.title}</h3>{node.props.children.map(leaf)}</section>:leaf(node))}
      {staleChoices?<div className="compare-stays-attention" role="status"><p>Stay details changed. Review the current options before continuing with your shortlist.</p><button className="cm-action" type="button" onClick={()=>update({...choices,ids:selected,revision:catalog.comparison.revision})}>Use these current options</button></div>:null}
      {presentationBlocks(presentation.view!).some(n=>n.component==='StayComparison')&&selected.length>0?<footer className="compare-stays-footer"><p>Shortlisted in this browser session: {selected.map(id=>catalog.comparison.options.find(s=>s.id===id)!.name).join(' · ')}</p>{path?<a className="cm-action cm-action--primary" href={path} target="_blank" rel="noopener noreferrer">Review a poll with these stays<span className="sr-only"> (opens in a new tab)</span></a>:<p>Choose at least two current options to review a poll.</p>}<p className="review-caption">A shortlist is not a booking or a decision. The existing poll editor rechecks saved details; sharing requires its separate review.</p></footer>:null}
    </>}
    {storageError?<p role="alert">These choices could not be kept in this browser. Keep this view open or choose them again after reloading.</p>:null}
  </section>;
}
