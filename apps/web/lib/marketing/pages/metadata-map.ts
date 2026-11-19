import { tripTypes } from './catalog';
import { destinationCatalog } from './destinations/data';
import { coordinationGuides } from './guides/data';
/** Publication candidates only. Never emitted as a live sitemap or canonical URL. */
export function publicPageCandidates() {
 return [
  ...['group-trip-planner','trip-templates','destinations','group-organizers','pricing','assistants','assistants/chatgpt','assistants/claude','assistants/gemini','partners/destinations','docs/assistant-handoff'].map(path=>({path:`/${path}/`,family:'core',indexable:false})),
  ...tripTypes.map(t=>({path:`/trip-templates/${t.slug}/`,family:'template',indexable:false})),
  ...destinationCatalog.map(d=>({path:`/destinations/${d.slug}/`,family:'destination',indexable:false})),
  ...coordinationGuides.map(g=>({path:`/guides/${g.slug}/`,family:'guide',indexable:false})),
 ];
}
