import Link from 'next/link';
import { CommonsWordmark } from '@commons/ui';
import css from './page-shell.module.css';

/** Plain page chrome for support and legal pages: wordmark home link plus content. */
export function PageShell({ children }: { children: React.ReactNode }) {
  return <div className={css.root}><a className={css.skip} href="#main-content">Skip to content</a><header className={css.header}><Link href="/" aria-label="Commons homepage"><CommonsWordmark/></Link></header><main id="main-content" className={css.main}>{children}</main></div>;
}
