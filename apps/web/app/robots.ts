import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';
export const dynamic='force-dynamic';
export default function robots():MetadataRoute.Robots{
 // Let crawlers see the noindex on the creation entry.
 // Other trip and creation paths remain disallowed; access control is unchanged.
 const allow=['/','/support/','/legal/','/new/$','/new/?'];
 return {rules:{userAgent:'*',allow,disallow:['/api/','/account/','/auth/','/sign-in/','/new/','/trips/','/c/','/poll/','/polls/','/profile/','/welcome/','/join/','/group-join/']},sitemap:siteOrigin()+'/sitemap.xml'};
}
