import { tripTypes } from './templates';
import { destinationCatalog } from './destinations';
import { coordinationGuides } from './pages/guides/data';
import { getRouteArtwork, destinationArtwork, getTemplateArtwork } from './artwork';
export function marketingShareContent(path:string){
 const clean=path.replace(/^\/+|\/+$/g,'');
 const [family,slug]=clean.split('/');
 if(clean.split('/').length>2)return null;
 const template=family==='trip-templates'?tripTypes.find(item=>item.slug===slug):undefined;
 const destination=family==='destinations'?destinationCatalog.find(item=>item.slug===slug):undefined;
 const guide=family==='guides'?coordinationGuides.find(item=>item.slug===slug):undefined;
 const core:Record<string,string>={'trip-templates':'Find a trip like yours','destinations':'Where could you go together?','group-trip-planner':'Get the group trip out of the group chat.','group-organizers':'Group trips for clubs, churches and communities','pricing':'One trip. Everyone included.','assistants':'Plan where you are. Bring the group here.','assistants/chatgpt':'From ChatGPT to a shared trip','assistants/claude':'From Claude to a shared trip','assistants/gemini':'From Google Gemini to a shared trip','docs/assistant-handoff':'Your ideas. A shared starting point.','partners/destinations':'Help groups find your destination','partners/travel-assistants':'You plan and book. We help with the group.'};
 const title=template?.label??(destination?`A group trip to ${destination.name}`:undefined)??guide?.title??core[clean];
 const artwork=template?getTemplateArtwork(template.slug):destination?destinationArtwork[destination.slug]:getRouteArtwork(clean);
 return title&&artwork?{title,artwork}:null;
}
