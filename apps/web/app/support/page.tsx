import { AnalyticsChoices } from '@/components/analytics-choices';
import Link from 'next/link';
import { marketingOrigin } from '@/lib/marketing/route-mode';
import { feedbackContactEmail } from '@/lib/feedback-contact';
import { MarketingShell } from '@/lib/marketing/pages/layout';
import css from '@/lib/marketing/pages/pages.module.css';

export const metadata = {
  title: 'Support and your data — Commons',
  alternates: { canonical: `${marketingOrigin()}/support/` },
  description: 'Get help with Commons, find your trip, download expense records, or request a copy or deletion of your personal data.',
};

export default function SupportPage() {
  const request = (subject: string) => `mailto:${feedbackContactEmail}?subject=${encodeURIComponent(subject)}`;
  return <MarketingShell>
    <h1>Support and your data</h1>
    <p className={css.lead}>A little help getting back to your trip, and clear ways to manage your information.</p>
    <section className={css.section}>
      <h2>Get help</h2>
      <p>Use <strong>Feedback</strong> in your trip to report a problem or suggest an improvement. You can also email us directly.</p>
      <div className={css.actions}><a className={css.primary} href={request('Commons support')}>Email Commons support</a></div>
      <p>Opens your email app. You can also write to <a href={request('Commons support')}>{feedbackContactEmail}</a>.</p>
      <p>Tell us what you were trying to do, what happened, and which page you were on. If useful, attach a screenshot with private information covered. Never send a password, sign-in code or payment-card details.</p>
    </section>
    <section className={css.section}>
      <h2>Finding your trip</h2>
      <p>Invited to a trip? Sign in using the email address your invitation was sent to. If you cannot find the invitation or are unsure which address was used, ask your organizer to check.</p>
      <p>If you still cannot get in, email support from the address you use for Commons and describe the problem.</p>
      <Link href="/sign-in/?next=%2Ftrips&intent=invited">Sign in to your trip →</Link>
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
      <p>Email us from the address you use to sign in. Say that you want a copy of your personal data, and whether your request concerns a particular trip or your account. We confirm the request with that address before acting and reply by email.</p>
      <a href={request('Commons data copy request')}>Request a copy by email →</a>
    </section>
    <section className={css.section}>
      <h2>Request deletion</h2>
      <p>Account deletion is handled by support. Email from your sign-in address and tell us what you want removed. We confirm your request before acting.</p>
      <p>Some records belong to a shared trip, such as expenses other people rely on. Before anything is removed, we explain what can be deleted and what stays with the trip. A request does not automatically delete another person’s records or the whole group’s trip.</p>
      <a href={request('Commons data deletion request')}>Request deletion by email →</a>
    </section>
    <section id="analytics" className={css.section}><h2>Analytics choices</h2><AnalyticsChoices /></section>
  </MarketingShell>;
}
