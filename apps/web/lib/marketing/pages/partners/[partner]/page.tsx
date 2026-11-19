import { getRouteArtwork } from '@/lib/marketing/artwork';
import { notFound } from 'next/navigation';
import Link from 'next/link';
import { IllustratedIntro } from '../../intro';
import { InquiryEntry } from '../../inquiry-entry';
import { discoverHref } from '../../routes';
import css from '../../pages.module.css';
type Props = { params: Promise<{ partner: string }> };
export async function generateMetadata({ params }: Props) {
  const { partner } = await params;
  return { title: partner === 'destinations' ? 'Destination sponsorship for group travel | Commons' : 'For travel assistants and advisors | Commons', description: partner === 'destinations' ? 'Reach groups exploring their next trip. Talk with Commons about destination guides, trip ideas and future sponsorship opportunities.' : 'You make planning and booking great. Commons helps with the group: answers, shared arrangements and expenses.' };
}
export default async function Page({ params }: Props) {
  const { partner } = await params;
  if (!['destinations', 'travel-assistants'].includes(partner)) notFound();
  const destination = partner === 'destinations';
  return <>
    <IllustratedIntro image={getRouteArtwork(`partners/${partner}`)?.src}>
      <h1>{destination ? 'Be part of where the group goes next.' : 'You plan the travel. We help with the group.'}</h1>
      <p className={css.lead}>{destination ? 'Help groups picture a trip to your destination, from choosing where to stay to finding things they’ll enjoy together.' : 'Keep making planning and booking great. Commons helps organizers gather answers, bring separate bookings together and work out shared costs.'}</p>
      <div className={css.actions}><a className={css.primary} href="#inquiry">{destination ? 'Ask about sponsorship' : 'Talk with us'}</a><Link href={discoverHref(destination ? 'destinations' : 'docs/assistant-handoff')}>{destination ? 'Explore our destination guides' : 'See the planning brief'} →</Link></div>
    </IllustratedIntro>
    <section className={css.section}>
      <h2>{destination ? 'Reach people while they’re choosing.' : 'Help a good plan become a trip.'}</h2>
      <p>{destination ? 'A family reunion, a club weekend or a trip with friends starts with a few people asking, “Where should we go?” Our destination guides and trip templates help them compare places and start making plans.' : 'Once the ideas are there, someone still has to find dates, hear from everyone and keep the details straight. Commons gives the organizer a shared place for that work, including travel booked independently by each person.'}</p>
      <h2>{destination ? 'Tell your destination’s group-travel story.' : 'Keep doing what you do best.'}</h2>
      <p>{destination ? 'We’re exploring sponsorships with tourism boards and destination organizations. We’d like to hear what makes your area work for groups: a good place to gather, manageable arrivals, and experiences for different interests.' : 'Your recommendations, supplier relationships and booking support stay with you. The organizer adds the plans they want to keep to Commons. Our brief format can help prepare that information; a direct assistant connection is not available yet.'}</p>
      {destination && <p>Sponsorships will be clearly identified. We’re discussing the first partnerships now; pricing, placement and reporting will be agreed before any campaign begins.</p>}
    </section>
    <section id="inquiry" className={css.section}><h2>{destination ? 'Bring your destination to the conversation.' : 'Tell us about your travel assistant.'}</h2><InquiryEntry kind={destination ? 'destination' : 'travel-assistant'} /></section>
  </>;
}
