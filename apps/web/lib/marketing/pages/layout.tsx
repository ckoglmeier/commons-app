import Link from 'next/link';
import { MarketingHomeFooter } from '../home-footer';
import { CommonsWordmark } from '@commons/ui';
import { discoverHref } from './routes';
import css from './pages.module.css';
export function MarketingShell({children}:{children:React.ReactNode}){
 return <div className={css.root}><a className={css.skip} href="#main-content">Skip to content</a><header className={css.header}><Link href="/" aria-label="Commons homepage"><CommonsWordmark/></Link><nav aria-label="Explore Commons"><Link href={discoverHref('trip-templates')}>Trip templates</Link><Link href={discoverHref('destinations')}>Destinations</Link><Link href={discoverHref('group-organizers')}>Clubs & community groups</Link></nav></header><main id="main-content" className={css.main}>{children}</main><MarketingHomeFooter/></div>;
}
