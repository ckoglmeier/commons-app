import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 const retiredSamples=['10000000-0000-4000-8000-000000000001','cape-cod-couples-week','austin-weekend'];
 // Let crawlers see the retired-sample redirects and the noindex on the creation entry.
 // Other trip and creation paths remain disallowed; access control is unchanged.
 const allow=['/','/support/','/legal/','/new/$','/new/?',...retiredSamples.flatMap(id=>[`/c/${id}/`,`/c/${id}$`,`/c/${id}?`])];
 return {rules:{userAgent:'*',allow,disallow:['/api/','/account/','/auth/','/sign-in/','/new/','/trips/','/c/','/poll/','/polls/','/profile/','/welcome/','/join/','/group-join/']},sitemap:siteOrigin()+'/sitemap.xml'};
}
