import type { ItineraryContent } from "@commons/contracts";
import type { itineraryResults } from "./itinerary-workshop";
export async function publishedItineraryId(documentId: string, key: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([documentId, `public:${key}`])));
  const h = Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
export type PublishedPreferences = Record<string, Array<{ id: string; label: string; preferences: number; names: string[] }>>;
export async function itineraryPublishedPreferences(documentId: string, items: ItineraryContent["items"], results: ReturnType<typeof itineraryResults>): Promise<PublishedPreferences> {
  const entries = await Promise.all(items.map(async item => {
    const publicId = await publishedItineraryId(documentId, `item:${item.id}`);
    const row = results?.choices.find(row => row.id === publicId);
    const options = await Promise.all((item.decision?.shortlist ?? []).map(async option => {
      const id = await publishedItineraryId(documentId, `choice:${item.id}:option:${option.id}`);
      // Earlier rounds published before shortlist conversion used a label-derived UUID.
      // It remains scoped to the exact document and stop; renamed legacy choices do not inherit votes.
      const legacyId = await publishedItineraryId(documentId, `choice:${item.id}:${option.label}`);
      const published = row?.options.find(value => value.id === id || value.id === legacyId);
      return published ? { id: option.id, label: published.label, preferences: published.people.length, names: published.people } : null;
    }));
    return [item.id, options.filter((option): option is NonNullable<typeof option> => option !== null)] as const;
  }));
  return Object.fromEntries(entries);
}
