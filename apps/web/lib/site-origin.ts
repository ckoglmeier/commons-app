/** Public origin of this deployment, used for canonical URLs, the sitemap and robots. */
export function siteOrigin() {
  const url = new URL(process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000');
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Site URL must use HTTP or HTTPS.');
  return url.origin;
}
