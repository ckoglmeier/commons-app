import { notFound, redirect } from 'next/navigation';
import { fillPolicyText, instanceSettings } from '@/lib/instance';
import Link from 'next/link';
import { PageShell } from '@/components/page-shell';
import policies from '@/lib/legal/policies.json';
import { LEGAL_EFFECTIVE_DATE } from '@/lib/legal/version';
import { siteOrigin } from '@/lib/site-origin';
import css from './legal.module.css';

export const dynamic = 'force-dynamic';
export async function generateMetadata({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  const item = policies[document as keyof typeof policies];
  return { title: `${item?.title ?? 'Legal'} | Commons`, alternates: { canonical: `${siteOrigin()}/legal/${document}/` }, robots: { index: true, follow: true } };
}

export default async function Page({ params }: { params: Promise<{ document: string }> }) {
  const { document } = await params;
  if (document !== 'terms' && document !== 'privacy') notFound();
  const settings = instanceSettings();
  const external = document === 'terms' ? settings.termsUrl : settings.privacyUrl;
  if (external) redirect(external);
  const item = policies[document];
  return <PageShell><article className={css.document} aria-labelledby="legal-title">
    <header className={css.header}>
      <h1 id="legal-title">{item.title}</h1>
      <p className={css.metadata}>{settings.ownerName}</p>
      <p className={css.metadata}>Effective date: {LEGAL_EFFECTIVE_DATE}</p>
    </header>
    <nav className={css.contents} aria-label="Document contents"><h2>Contents</h2><ol>{item.sections.map(([heading], index) => <li key={heading}><a href={`#section-${index + 1}`}>{heading.replace(/^\d+\.\s*/, '')}</a></li>)}</ol></nav>
    {item.sections.map(([heading, body], index) => <section className={css.section} id={`section-${index + 1}`} key={heading}><h2>{index + 1}. {heading.replace(/^\d+\.\s*/, '')}</h2><p>{fillPolicyText(body, settings)}</p></section>)}
    <nav className={css.related} aria-label="Related legal documents"><Link href={document === 'terms' ? '/legal/privacy/' : '/legal/terms/'}>{document === 'terms' ? 'Privacy Policy' : 'Terms of Use'}</Link><Link href="/support/">Support and your data</Link></nav>
  </article></PageShell>;
}
