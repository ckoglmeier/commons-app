import { marketingRoutesEnabled } from '../../../../lib/marketing/route-mode';
import { assistantBriefJsonSchema } from '../../../../lib/marketing/assistant-schema';
export const dynamic = 'force-dynamic';
export function GET() {
 const headers = {'Cache-Control':'no-store', 'X-Robots-Tag':'noindex, nofollow'};
 if (!marketingRoutesEnabled()) return new Response(null,{status:404,headers});
 return Response.json(assistantBriefJsonSchema(),{headers});
}
