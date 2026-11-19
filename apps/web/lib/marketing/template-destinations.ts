import { destinationCatalog } from './destinations';
/** Editorial examples, not a claim that these are the only suitable destinations. */
export const templateDestinations:Record<string,string[]>={
 'family-reunions':['asheville','cape-cod','gatlinburg'],
 'friends-trips':['lisbon','new-york','charleston'],
 'family-vacations':['san-diego','oahu','san-antonio'],
 'girls-trips':['savannah','santa-barbara','sonoma'],
 'guys-trips':['scottsdale','austin','lake-tahoe'],
 'bachelor-trips':['new-orleans','austin','las-vegas'],
 'bachelorette-trips':['nashville','palm-springs','miami'],
 'birthday-trips':['cabo-san-lucas','new-york','lisbon'],
 'ski-trips':['park-city','breckenridge','whistler'],
 'golf-trips':['scottsdale','hilton-head','myrtle-beach'],
 'beach-trips':['outer-banks','gulf-shores','cape-cod'],
 'camping-trips':['banff','lake-tahoe','gatlinburg'],
 'road-trips':['sedona','santa-fe','san-diego'],
 'festival-trips':['austin','new-orleans','chicago'],
 'retreats':['sedona','asheville','santa-fe'],
 'wedding-guest-travel':['charleston','savannah','sonoma'],
 'cruise-groups':['miami','san-juan','san-diego'],
 'church-community-trips':['gatlinburg','asheville','san-antonio'],
};
export function destinationsForTemplate(slug:string){return (templateDestinations[slug]??[]).flatMap(key=>{const destination=destinationCatalog.find(d=>d.slug===key);return destination?[destination]:[];});}
