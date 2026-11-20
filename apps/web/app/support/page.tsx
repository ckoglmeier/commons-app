import { AnalyticsChoices } from '@/components/analytics-choices';
import Link from 'next/link';
import { siteOrigin } from '@/lib/site-origin';
import { instanceSettings } from '@/lib/instance';
import { emailDeliveryAvailable } from '@/lib/email/resend';
import { PageShell } from '@/components/page-shell';
import css from '@/components/page-shell.module.css';

export const metadata = {
  title: 'Support and your data — Commons',
  alternates: { canonical: `${siteOrigin()}/support/` },
  description: 'Get help with this copy of Commons, find your trip, download expense records, or ask for a copy or deletion of your personal data.',
};

export default function SupportPage() {
  const { contactEmail, ownerName, ownerNamed } = instanceSettings();
  const runBy = ownerNamed ? ownerName.replace(/^The /, 'the ') : 'the person who set it up';
  const emailSignIn = emailDeliveryAvailable();
  const request = (subject: string) => `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}`;
  return <PageShell>
    <h1>Support and your data</h1>
    <p className={css.lead}>A little help getting back to your trip, and clear ways to manage your information.</p>
    <section className={css.section}>
      <h2>Get help</h2>
      <p>Commons is open source, and this copy is run by {runBy}. There’s no central support team.</p>
      {contactEmail ? <>
        <p>For help, email <a href={request('Commons help')}>{contactEmail}</a>.</p>
        <div className={css.actions}><a className={css.primary} href={request('Commons help')}>Email for help</a></div>
        <p>You can also choose <strong>Give feedback</strong> in your account menu.</p>
      </> : <p>For help, ask them, or the organizer who invited you.</p>}
      <p>Say what you were trying to do, what happened, and which page you were on. A screenshot helps; cover anything private first. Never send a password, a sign-in link or card details.</p>
    </section>
    <section className={css.section}>
      <h2>Finding your trip</h2>
      {emailSignIn ? <p>Invited to a trip? Sign in with the email address your invitation was sent to. If you can’t find the invitation or aren’t sure which address was used, ask your organizer to check.</p> : <p>Invited to a trip? Open the invite link your organizer sent you, then create an account or sign in. If you’ve lost the link, ask your organizer for a new one. If you forgot your password, the person who runs this copy can reset it.</p>}
      <p>Still stuck? Ask the person who runs this copy.</p>
      <Link href="/sign-in/?next=%2Ftrips">Sign in to your trip →</Link>
    </section>
    <section className={css.section}>
      <h2>Things you can manage in your trip</h2>
      <ul>
        <li><strong>Expense records:</strong> in Money, open <strong>Trip ledger</strong>, then choose <strong>Download CSV</strong> or <strong>Print / Save PDF</strong>. This exports the ledger, not every piece of data in your account.</li>
        <li><strong>Poll answers:</strong> edit your own response while voting is open. If voting has closed, contact your organizer.</li>
        <li><strong>Attendance:</strong> in People, find <strong>Your attendance</strong>, choose <strong>I can’t attend</strong>, then <strong>Decline and leave trip</strong>. Leaving a trip is separate from requesting deletion of your account data.</li>
      </ul>
    </section>
    <section className={css.section}>
      <h2>Request a copy of your data</h2>
      <p>Ask the person who runs this copy for a copy of your personal data. Say whether you mean one trip or your whole account. Expect them to confirm it’s you, using your sign-in email, before sending anything.</p>
      {contactEmail ? <a href={request('Commons data copy request')}>Ask by email →</a> : null}
    </section>
    <section className={css.section}>
      <h2>Request deletion</h2>
      <p>Ask the person who runs this copy to delete your account, and say what you want removed.</p>
      <p>Some records belong to a shared trip, such as expenses other people rely on. A request doesn’t automatically delete another person’s records or the whole group’s trip, so expect to be told what can be removed and what stays.</p>
      {contactEmail ? <a href={request('Commons data deletion request')}>Ask by email →</a> : null}
    </section>
    {process.env.NEXT_PUBLIC_POSTHOG_KEY ? <section id="analytics" className={css.section}><h2>Analytics choices</h2><AnalyticsChoices /></section> : null}
  </PageShell>;
}
