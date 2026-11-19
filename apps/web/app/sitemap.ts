import type { MetadataRoute } from 'next';
import { siteOrigin } from '@/lib/site-origin';
export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap{return ['/','/support/','/legal/privacy/','/legal/terms/'].map(path=>({url:siteOrigin()+path}));}
