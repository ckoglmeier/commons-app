import { tripTypes } from '../templates';
export const discoverHref=(path='')=>{const clean=path.replace(/^\/+|\/+$/g,'');return `/${tripTypes.some(t=>t.slug===clean)?'trip-templates/':''}${clean||'trip-templates'}/`;};
/** Existing authenticated request path; no draft, checkout or invitation is created here. */
export const betaRequestHref='/sign-in?next=%2Fnew%3Faccess%3Drequest&intent=access';
export const starterHref=(_template?:string,_destination?:string,_source?:string)=>{ void _template; void _destination; void _source; return betaRequestHref; };
/** The public sample uses synthetic, device-local records. */
export const sampleHref=()=>'/c/10000000-0000-4000-8000-000000000001/?arrival=0';
