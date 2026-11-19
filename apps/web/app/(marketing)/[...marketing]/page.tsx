import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { marketingRoutesEnabled, marketingIndexingEnabled, marketingOrigin } from '../../../lib/marketing/route-mode';
import { publicPageCandidates } from '@/lib/marketing/pages/metadata-map';
import { MarketingShell } from '@/lib/marketing/pages/layout';
import TemplateHub from '@/lib/marketing/pages/page';
import Core, { generateMetadata as coreMetadata } from '@/lib/marketing/pages/[slug]/page';
import Destinations, { metadata as destinationsMetadata } from '@/lib/marketing/pages/destinations/page';
import Destination, { generateMetadata as destinationMetadata } from '@/lib/marketing/pages/destinations/[slug]/page';
import Assistants, { metadata as assistantsMetadata } from '@/lib/marketing/pages/assistants/page';
import Assistant, { generateMetadata as assistantMetadata } from '@/lib/marketing/pages/assistants/[assistant]/page';
import Guide, { generateMetadata as guideMetadata } from '@/lib/marketing/pages/guides/[guide]/page';
import Partner, { generateMetadata as partnerMetadata } from '@/lib/marketing/pages/partners/[partner]/page';
import Handoff, { metadata as handoffMetadata } from '@/lib/marketing/pages/docs/assistant-handoff/page';

type Props = { params: Promise<{ marketing: string[] }> };
export const dynamic = 'force-dynamic';
async function resolve(props: Props) {
 const { marketing } = await props.params;
 if (!marketingRoutesEnabled() || !publicPageCandidates().some(page => page.path === `/${marketing.join('/')}/`)) notFound();
 return marketing;
}
export async function generateMetadata(props: Props): Promise<Metadata> {
 const [family, slug] = await resolve(props);
 let details: Metadata = family === 'destinations' ? destinationsMetadata : family === 'assistants' ? assistantsMetadata : family === 'docs' ? handoffMetadata : { title: 'Trip templates for thoughtful group travel', description:'Start with a trip template for your group. Adapt the questions, outline and illustration before sharing your plan.' };
 if (family === 'trip-templates' && slug) details = await coreMetadata({params:Promise.resolve({slug})});
 else if (family === 'destinations' && slug) details = await destinationMetadata({params:Promise.resolve({slug})});
 else if (family === 'assistants' && slug) details = await assistantMetadata({params:Promise.resolve({assistant:slug})});
 else if (family === 'guides') details = await guideMetadata({params:Promise.resolve({guide:slug})});
 else if (family === 'partners') details = await partnerMetadata({params:Promise.resolve({partner:slug})});
 else if (!['trip-templates','destinations','assistants','docs'].includes(family)) details = await coreMetadata({params:Promise.resolve({slug:family})});
 const image=`/marketing-share/${(await props.params).marketing.join('/')}/`;
 const title=typeof details.title==='string'?details.title:'Group travel with Commons';
 return {...details, metadataBase:new URL(marketingOrigin()), alternates:{canonical:`/${(await props.params).marketing.join('/')}/`}, robots:{index:marketingIndexingEnabled(),follow:marketingIndexingEnabled()},openGraph:{type:'website',title,description:details.description??undefined,images:[{url:image,width:1200,height:630,alt:title}]},twitter:{card:'summary_large_image',title,description:details.description??undefined,images:[image]}};
}
export default async function Page(props: Props) {
 const [family, slug] = await resolve(props);
 let content;
 if (family === 'trip-templates') content = slug ? <Core params={Promise.resolve({slug})}/> : <TemplateHub/>;
 else if (family === 'destinations') content = slug ? <Destination params={Promise.resolve({slug})}/> : <Destinations/>;
 else if (family === 'assistants') content = slug ? <Assistant params={Promise.resolve({assistant:slug})}/> : <Assistants/>;
 else if (family === 'guides') content = <Guide params={Promise.resolve({guide:slug})}/>;
 else if (family === 'partners') content = <Partner params={Promise.resolve({partner:slug})}/>;
 else if (family === 'docs') content = <Handoff/>;
 else content = <Core params={Promise.resolve({slug:family})}/>;
 const path=`/${(await props.params).marketing.join('/')}/`;
 const schema={"@context":"https://schema.org","@type":"BreadcrumbList",itemListElement:[{"@type":"ListItem",position:1,name:"Commons",item:marketingOrigin()+"/"},{"@type":"ListItem",position:2,name:family.replaceAll('-',' '),item:marketingOrigin()+`/${family}/`},...(slug?[{"@type":"ListItem",position:3,name:slug.replaceAll('-',' '),item:marketingOrigin()+path}]:[])]};
 // Docs/partners have no standalone index route; use the actual page as the second crumb.
 if(['docs','partners','guides'].includes(family))schema.itemListElement=[schema.itemListElement[0],{"@type":"ListItem",position:2,name:slug?.replaceAll('-',' ')??family,item:marketingOrigin()+path}];
 return <MarketingShell><script type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(schema).replace(/</g,'\\u003c')}}/>{content}</MarketingShell>;
}
