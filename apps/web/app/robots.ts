import type { MetadataRoute } from 'next';
import { marketingIndexingEnabled,marketingOrigin } from '@/lib/marketing/route-mode';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 const retiredSamples=['10000000-0000-4000-8000-000000000001','cape-cod-couples-week','austin-weekend'];
 // Let crawlers see the retired-sample redirects and the noindex on the creation entry.
 // Other trip and creation paths remain disallowed; access control is unchanged.
 const allow=['/','/new/$','/new/?',...retiredSamples.flatMap(id=>[`/c/${id}/`,`/c/${id}$`,`/c/${id}?`])];
 return {rules:{userAgent:'*',allow,disallow:['/api/','/admin/','/account/','/auth/','/sign-in/','/new/','/trips/','/c/','/poll/','/polls/','/profile/','/welcome/','/join/','/group-join/','/prototype/','/launch/','/launch-media/']},...(marketingIndexingEnabled()?{sitemap:marketingOrigin()+'/sitemap.xml'}:{})};
}
