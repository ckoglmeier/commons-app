import { templateGuidance } from '@/lib/marketing/template-guidance';
import { destinationsForTemplate } from '@/lib/marketing/template-destinations';
import { coordinationGuides } from '../guides/data';
import { discoverHref, starterHref } from '../routes';
import { getTemplateArtwork } from '@/lib/marketing/artwork';
import { corePages, CorePage } from '../core-content';
import { IllustratedIntro } from '../intro';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { tripTypes } from '../catalog';
import css from '../pages.module.css';
type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const {slug}=await params; const trip=tripTypes.find(t=>t.slug===slug);
 if(slug in corePages){const page=corePages[slug as keyof typeof corePages];return {title:page.title,description:page.description};}
 return {title:trip?templateGuidance[trip.slug]?.title??trip.label:'Commons preview',description:trip?.intro};
}
export default async function Page({params}:Props){
 const {slug}=await params; if(slug in corePages) return <CorePage slug={slug as keyof typeof corePages}/>; const trip=tripTypes.find(t=>t.slug===slug); if(!trip) notFound(); const guidance=templateGuidance[trip.slug];
 return <><IllustratedIntro image={getTemplateArtwork(trip.slug)?.src}><h1>{trip.label}</h1><p className={css.lead}>{trip.intro}</p><div className={css.actions}><Link className={css.primary} href={starterHref(trip.slug)}>Request beta access</Link><Link href="#trip-example">See this trip example →</Link></div></IllustratedIntro>{guidance&&<section className={css.section}><h2>{guidance.question}</h2><p>{guidance.answer}</p></section>}<section id="trip-example" className={css.split}><div><h2>An example: {trip.example.charAt(0).toLowerCase() + trip.example.slice(1)}</h2><p>{guidance?.scenario}</p><p>An example for your group to adapt.</p><ol>{(guidance?.decisions??trip.steps).map(step=><li key={step}>{step}</li>)}</ol></div><aside className={css.example}><h2>Ask your group</h2><blockquote>“{trip.question}”</blockquote><p>A suggested question you can adapt before sharing.</p></aside></section><section className={css.section}><h2>A starting itinerary</h2><ol>{trip.outline.map(item=><li key={item}>{item}</li>)}</ol><p>Choose the dates, places and pace that work for your group.</p></section>{guidance&&<section className={css.section}><h2>Keep shared and optional costs separate</h2><p>{guidance.cost}</p><p>These example amounts show how to split costs; they are not travel prices.</p><h2>{guidance.followup}</h2><p>{guidance.response}</p></section>}<section className={css.section}><h2>Bring this starting point to your group</h2><p>Use the questions and outline above to start the conversation. Request beta access to organize your trip in Commons. Approval is required; the example above is yours to use while you wait.</p><p>{trip.limit}</p></section><section className={css.section}><h2>Find a place that works for your group</h2><p>Choose a few places to compare, then ask which options people can make. Request beta access to use Commons polls with your group.</p><div className={css.guideLinks}>{destinationsForTemplate(trip.slug).map(place=><Link key={place.slug} href={discoverHref(`destinations/${place.slug}`)}>{place.name} →</Link>)}{coordinationGuides.filter(guide=>guide.template===trip.slug).map(guide=><Link key={guide.slug} href={discoverHref(`guides/${guide.slug}`)}>{guide.title} →</Link>)}</div></section><div className={css.actions}><Link className={css.primary} href={starterHref(trip.slug)}>Request beta access</Link><Link href={discoverHref()}>Explore other templates</Link></div></>;
}
