/** Public venue evidence only: never project personal, account or booking links into Coordinator context. */
export function publicActivityWebsite(raw: string | null | undefined): string | null {
  if (!raw || raw.length > 2048) return null;
  try {
    const url = new URL(raw), host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.search
      || !host.includes(".") || !/[a-z]/i.test(host) || host.includes(":")
      || /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)) return null;
    let path = url.pathname;
    for (let depth = 0; depth < 3 && /%[0-9a-f]{2}/i.test(path); depth++) path = decodeURIComponent(path);
    if (path.includes("@") || /%[0-9a-f]{2}/i.test(path)
      || /\b(?:account|login|booking|reservation|confirmation|receipt|invoice|checkout)\b/i.test(path)) return null;
    url.hash = "";
    return url.href;
  } catch { return null; }
}
