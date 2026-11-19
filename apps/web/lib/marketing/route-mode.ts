/** Content visibility and crawl permission are independent, explicit release switches. */
export const marketingRoutesEnabled=()=>process.env.COMMONS_MARKETING_ROUTES_ENABLED==='true';
export const marketingIndexingEnabled=()=>marketingRoutesEnabled()&&process.env.COMMONS_MARKETING_INDEXING_ENABLED==='true';
export function marketingOrigin(){
 const configured=process.env.NEXT_PUBLIC_SITE_URL||'https://www.commons.travel';
 const url=new URL(configured);
 if(!['http:','https:'].includes(url.protocol))throw new Error('Marketing site URL must use HTTP or HTTPS.');
 return url.origin;
}
