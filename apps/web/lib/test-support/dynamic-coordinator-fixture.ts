import { CoordinatorThreadSchema, type CoordinatorThread, type CoordinatorUiView, type CoordinatorPresentation, type CommonsSnapshot } from '@commons/contracts';
import { syntheticDraft } from '../../../../packages/contracts/src/fixtures/research-itinerary';
import { pilotSnapshot } from '../pilot-fixture';
import { compareStayFixtures } from './compare-stays-fixture';
import { presentationCatalog } from '../coordinator-presentation';
export const dynamicThreadId='50000000-0000-4000-8000-000000000001',dynamicOtherThreadId='50000000-0000-4000-8000-000000000002';
export const dynamicTurnId='60000000-0000-4000-8000-000000000002';
export function fixtureCatalog(snapshot:CommonsSnapshot,thread:CoordinatorThread,turnId=dynamicTurnId){return presentationCatalog({commons:snapshot.commons,stays:snapshot.state.stays??[],itinerary:snapshot.state.itinerary,thread,threadId:dynamicThreadId,beforeTurnId:turnId});}
export function fixturePresentation(snapshot:CommonsSnapshot,thread:CoordinatorThread,turnId:string,view:CoordinatorUiView|null,status:CoordinatorPresentation['status']='ready'):CoordinatorPresentation{const c=fixtureCatalog(snapshot,thread,turnId);return {schemaVersion:1,tripId:c.tripId,threadId:c.threadId,turnId,basis:c.basis,status,view};}
export function dynamicCoordinatorFixture(){
 const snapshot=structuredClone(pilotSnapshot),at='2026-10-16T12:00:00Z';snapshot.commons.name='Synthetic Scotland trip';snapshot.commons.timezone='Europe/London';snapshot.state.stays=compareStayFixtures(snapshot.currentActor.id);snapshot.currentActor.role='organizer';
 const draft=syntheticDraft();draft.threadId=dynamicThreadId;draft.ownerId=snapshot.currentActor.id;
 const first={id:'60000000-0000-4000-8000-000000000001',sequence:1,threadId:dynamicThreadId,userText:'Here is our private itinerary and research.',assistantText:'The saved draft is available to review.',draftId:null,createdAt:at,authorName:'Synthetic organizer',authorPersonId:snapshot.currentActor.id,status:'completed' as const,workspace:{itineraryDraft:draft,research:{query:'Saved hotel access research',status:'unavailable' as const,sources:[],limitations:[]},threadState:{v:1,summary:null,summaryTurnVersion:1,openQuestions:['Does the entrance have steps?','How many hotel rooms do we need?'],generatedTitle:null}}};
 const latest={id:dynamicTurnId,sequence:2,threadId:dynamicThreadId,userText:'Compare the saved stays, price first.',assistantText:'Here are the saved estimates and open questions.',draftId:null,createdAt:at,authorName:'Synthetic organizer',authorPersonId:snapshot.currentActor.id,status:'completed' as const,workspace:{tripConversation:true}};
 const summary=(id:string,title:string)=>({id,title,status:'active',version:1,createdByPersonId:snapshot.currentActor.id,createdByName:'Synthetic organizer',turnCount:id===dynamicThreadId?2:0,draftCount:0,pollCount:0,archivedAt:null,createdAt:at,updatedAt:at});
 const thread=CoordinatorThreadSchema.parse({version:2,activeThreadId:dynamicThreadId,threads:[summary(dynamicThreadId,'Coordinator'),summary(dynamicOtherThreadId,'Other conversation')],turns:[first,latest],drafts:[],polls:[],hasEarlier:false});
 const view:CoordinatorUiView={component:'Work',props:{children:[{component:'StayComparison',props:{ids:snapshot.state.stays!.map(s=>s.id),focus:'price'}},{component:'OpenQuestions',props:{ids:['question:0','question:1']}}]}};
 thread.turns[1].workspace={tripConversation:true,presentation:fixturePresentation(snapshot,thread,dynamicTurnId,view)};
 return {snapshot,thread};
}
