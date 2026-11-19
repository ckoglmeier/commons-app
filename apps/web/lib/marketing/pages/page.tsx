import { PageGuidance } from './page-guidance';
import { discoverHref } from './routes';
import { getRouteArtwork } from '@/lib/marketing/artwork';
import { IllustratedIntro } from './intro';
import Link from 'next/link';
import { tripTypes } from './catalog';
import css from './pages.module.css';
export default function Page() {
 return <><IllustratedIntro image={getRouteArtwork('trip-templates')?.src}><h1>Trip templates</h1><p className={css.lead}>Find a trip like yours. See how it could come together, then adapt the template for your group.</p></IllustratedIntro><PageGuidance page={'trip-templates'}/><div className={css.list}>{tripTypes.map(trip=><Link key={trip.slug} href={discoverHref(trip.slug)}><h2>{trip.label}<span aria-hidden="true"> ↗</span></h2><p>{trip.intro}</p></Link>)}</div></>;
}
