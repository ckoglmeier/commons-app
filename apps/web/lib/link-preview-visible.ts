type Text = (value: string | undefined, limit: number) => string | undefined;

/** Conservative fallback for a first-party venue contact block, not arbitrary page addresses. */
export function visibleVenueDetails(html: string, siteName: string, pageTitle: string, text: Text) {
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
  // A publisher/contact footer on an article must never become the article's venue.
  if (!/\b(museum|restaurant|winery|hotel|gardens?|park|gallery|cafe|café)\b/i.test(siteName) ||
      (!key(pageTitle).includes(key(siteName)) && !/^(?:about|visit|contact|hours|plan your visit)(?: us)?$/i.test(pageTitle))) return undefined;
  const visible = html.replace(/<!--[^]*?-->/g, "").replace(/<(script|style|nav|noscript|template)\b[^>]*>[^]*?<\/\1>/gi, "");
  const lines = visible.replace(/<br\b[^>]*>|<\/?(?:div|p|h[1-6]|address|li|section|footer)\b[^>]*>/gi, "\n")
    .split("\n").map(line => text(line, 2000)?.replace(/[\u200b-\u200d\ufeff]/g, "").trim()).filter((line): line is string => Boolean(line));
  const contacts = new Map<string, { location: string; phone: string }>();
  for (let i = 0; i < lines.length - 3; i++) {
    if (key(lines[i]) !== key(siteName)) continue;
    const street = lines[i + 1], city = lines[i + 2], phone = lines[i + 3];
    // Explicit US postal/contact block only. Other formats stay available for manual entry.
    if (!/^\d{1,6}\s+[\p{L}\d][\p{L}\d .'’#/-]{2,100}$/u.test(street) ||
        !/^[\p{L} .'’-]+,\s*[\p{L} .]+\s+\d{5}(?:-\d{4})?$/u.test(city) ||
        !/^(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}$/.test(phone)) continue;
    const location = `${street}, ${city}`;
    if (location.length > 160) continue;
    contacts.set(`${key(location)}:${phone.replace(/\D/g, "")}`, { location, phone });
  }
  if (contacts.size !== 1) return undefined;
  const contact = [...contacts.values()][0];
  return { location: contact.location, venueDetails: `Venue phone: ${contact.phone}` };
}
