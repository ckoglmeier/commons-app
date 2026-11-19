import type { MetadataRoute } from 'next';
import { marketingIndexingEnabled,marketingOrigin } from '@/lib/marketing/route-mode';
import { publicPageCandidates } from '@/lib/marketing/pages/metadata-map';
export const dynamic='force-dynamic';
export default function sitemap():MetadataRoute.Sitemap{return marketingIndexingEnabled()?['/','/support/','/legal/privacy/','/legal/terms/',...publicPageCandidates().map(p=>p.path)].map(path=>({url:marketingOrigin()+path})):[];}
