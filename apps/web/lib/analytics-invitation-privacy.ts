export function sensitiveAnalyticsPath(path: string) {
  return /^\/(?:auth|join|invite|group-join|sign-in|account|prototype)(?:\/|$)/i.test(path.split(/[?#]/)[0]);
}
/** Defense in depth for callers that arrive with an invitation in a return URL. */
export function redactInvitationPath(path: string) {
  const url = new URL(path, "https://commons.travel");
  url.pathname = url.pathname.replace(/\/(?:invite|join|group-join)\/[^/]+/gi, "/join/[token]");
  for (const [key, value] of url.searchParams) {
    if (["token", "invite", "invitation", "entry", "token_hash", "next", "redirect_to", "returnto"].includes(key.toLowerCase())) url.searchParams.set(key, "[redacted]");
    else url.searchParams.set(key, value.replace(/\/(?:invite|join|group-join)\/[^/?#]+/gi, "/join/[token]"));
  }
  return `${url.pathname}${url.search}`;
}
