import { tripTypes } from '../templates';
export const discoverHref=(path='')=>{const clean=path.replace(/^\/+|\/+$/g,'');return `/${tripTypes.some(t=>t.slug===clean)?'trip-templates/':''}${clean||'trip-templates'}/`;};
/** Sign in, then start a trip; no draft or invitation is created here. */
export const startTripHref='/sign-in?next=%2Fnew&intent=create';
export const starterHref=(_template?:string,_destination?:string,_source?:string)=>{ void _template; void _destination; void _source; return startTripHref; };
/** The public sample uses synthetic, device-local records. */
export const sampleHref=()=>'/c/10000000-0000-4000-8000-000000000001/?arrival=0';
