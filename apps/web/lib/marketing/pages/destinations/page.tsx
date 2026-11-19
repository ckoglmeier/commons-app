import Link from 'next/link';
import { PageGuidance } from '../page-guidance';
import { discoverHref } from '../routes';
import { getRouteArtwork } from '@/lib/marketing/artwork';
import { destinationCatalog } from './data';
import { DestinationSearch } from './destination-search';
import { IllustratedIntro } from '../intro';
import css from '../pages.module.css';
export const metadata={title:'Destinations for thoughtful group trips',description:'Explore 50 group-trip destinations with practical starting points for shared stays, arrivals, flexible plans and costs.'};
export default function Page(){return <><IllustratedIntro image={getRouteArtwork('destinations')?.src}><h1>Where could you go together?</h1><p className={css.lead}>Find a place that suits your group, then make a useful starting plan. Each destination connects to a template you can adapt.</p></IllustratedIntro><PageGuidance page={'destinations'}/><div data-review-destination-search><DestinationSearch places={destinationCatalog.map(({slug,name,region,intro})=>({slug,name,region,intro,href:discoverHref(`destinations/${slug}`)}))}/></div><section className={css.section}><h2>Represent a destination?</h2><p>Suggest a destination or talk with us about useful, clearly identified sponsorship for group travelers.</p><Link href={discoverHref('partners/destinations')}>Get in touch about your destination →</Link></section></>;}
