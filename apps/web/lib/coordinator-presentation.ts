import { CoordinatorUiViewSchema, type CoordinatorUiView, type CoordinatorPresentation, type CoordinatorUiBlock, type CoordinatorThread, type CommonsSummary, type Stay, type ItineraryItem } from '@commons/contracts';
import { compareStaysSnapshot, type CompareStaysSnapshot } from './compare-stays';
export type PresentationCatalog = {
  tripId: string; threadId: string; basis: string; comparison: CompareStaysSnapshot;
  questions: { id: string; text: string }[];
  artifacts: { id: string; kind: 'itinerary'|'poll'|'research'; recordId: string; title: string; version: string; selection: string }[];
};
// Content revision only, never an authorization token. Scope and IDs are checked independently.
function revision(text: string) {
  const words=[0x811c9dc5,0x9e3779b9,0x85ebca6b,0xc2b2ae35];
  for(let i=0;i<text.length;i++)for(let w=0;w<words.length;w++)words[w]=Math.imul(words[w]^text.charCodeAt(i)^(i+w),0x01000193);
  return words.map(w=>(w>>>0).toString(16).padStart(8,'0')).join('');
}
export function presentationCatalog(input: { commons: Pick<CommonsSummary,'id'|'timezone'>; stays: Stay[]; itinerary: ItineraryItem[]; thread: CoordinatorThread; threadId: string; beforeTurnId: string }): PresentationCatalog {
  const comparison=compareStaysSnapshot(input.commons,input.stays,input.itinerary);
  comparison.options=comparison.options.slice(0,24);
  const turns=input.thread.turns.filter(t=>t.threadId===input.threadId&&(t.status===undefined||t.status==='completed'));
  const before=input.thread.turns.findIndex(t=>t.id===input.beforeTurnId);
  const prior=turns.filter(t=>t.id!==input.beforeTurnId&&(before<0||input.thread.turns.indexOf(t)<before));
  const questions=(prior.findLast(t=>t.workspace?.threadState)?.workspace?.threadState?.openQuestions??[]).slice(0,8).map((text,i)=>({id:`question:${i}`,text}));
  const artifacts:PresentationCatalog['artifacts']=[];
  for(const turn of turns){const d=turn.workspace?.itineraryDraft;if(d){const id=`itinerary:${d.id}`;const index=artifacts.findIndex(a=>a.id===id);const item={id,kind:'itinerary' as const,recordId:d.id,title:d.content.title,version:String(d.version),selection:id};if(index<0)artifacts.push(item);else artifacts[index]=item;}
    if(turn.workspace?.research)artifacts.push({id:`research:${turn.id}`,kind:'research',recordId:turn.id,title:turn.workspace.research.query,version:revision(JSON.stringify(turn.workspace.research)),selection:`research:${turn.id}`});}
  for(const run of input.thread.researchRuns.filter(r=>r.threadId===input.threadId))artifacts.push({id:`run:${run.id}`,kind:'research',recordId:run.id,title:run.query,version:revision(JSON.stringify(run)),selection:`research-run:${run.id}`});
  for(const draft of input.thread.drafts.filter(d=>d.threadId===input.threadId&&!d.archivedAt&&!d.publishedPollId&&!d.data.privateItineraryDocument))artifacts.push({id:`draft:${draft.id}`,kind:draft.data.questions.some(q=>q.kind==='choice'&&q.itinerary)?'itinerary':'poll',recordId:draft.id,title:draft.data.title,version:String(draft.version),selection:`draft:${draft.id}`});
  const bounded=artifacts.slice(-24);
  return {tripId:input.commons.id,threadId:input.threadId,comparison,questions,artifacts:bounded,basis:revision(JSON.stringify({comparison:comparison.options,questions,artifacts:bounded}))};
}
export function presentationBlocks(view:CoordinatorUiView):CoordinatorUiBlock[]{return view.props.children.flatMap(n=>n.component==='Section'?n.props.children:[n]);}
export function validatePresentationView(value:unknown,catalog:PresentationCatalog):CoordinatorUiView|null {
  const parsed=CoordinatorUiViewSchema.safeParse(value);if(!parsed.success)return null;
  const blocks=presentationBlocks(parsed.data);if(blocks.length>8)return null;
  const seen=new Set<string>();
  for(const block of blocks){
    const key=block.component==='Artifact'?`${block.component}:${block.props.id}`:block.component;if(seen.has(key))return null;seen.add(key);
    if(block.component==='Artifact'){if(!catalog.artifacts.some(a=>a.id===block.props.id))return null;}
    else {const allowed=block.component==='StayComparison'?catalog.comparison.options:catalog.questions;if(new Set(block.props.ids).size!==block.props.ids.length||!block.props.ids.every(id=>allowed.some(a=>a.id===id)))return null;}
  }
  return parsed.data;
}
export function presentationIsCurrent(p:CoordinatorPresentation,c:PresentationCatalog,turnId:string){return p.schemaVersion===1&&p.tripId===c.tripId&&p.threadId===c.threadId&&p.turnId===turnId&&p.status==='ready'&&p.basis===c.basis&&Boolean(validatePresentationView(p.view,c));}
/** Keep model input bounded and explicitly projected. Never include codes, documents or traveler identities. */
export function presentationModelCatalog(c:PresentationCatalog){return {stays:c.comparison.options.map(s=>({id:s.id,name:s.name.slice(0,160),price:s.price,notes:s.notes?.slice(0,1200)??null,notesTruncated:(s.notes?.length??0)>1200,unknowns:s.unknowns})),openQuestions:c.questions,artifacts:c.artifacts.map(({id,kind,title})=>({id,kind,title:title.slice(0,160)}))};}
