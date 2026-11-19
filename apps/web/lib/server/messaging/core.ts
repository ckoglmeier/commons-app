import { createHash } from "node:crypto";
import { enqueueOutbound, getCommonsSnapshot, isWebAddress, type EnrolledTrip, type MessageRow } from "@commons/database";
import { messagingCopy, smsSegments, webMessagingCopy, type MessagingCopy } from "@commons/domain";
import { previewExternalLink } from "@/lib/link-preview";
import { instanceSettings } from "@/lib/instance";
import { commonsViewPath } from "@/lib/commons-route";
import { storeCommonsConfirmationAsset } from "@/lib/supabase/admin";
import { commonsSiteOrigin, requireCommonsDatabaseUrl } from "../runtime-environment";
import { deterministicExtractor, type BookingExtractor, type LinkReader } from "./extraction";
import { messagingProvider, unconfiguredProvider, type MessagingProvider } from "./provider";

export type MediaStore = { put(storagePath: string, bytes: Uint8Array, mimeType: string): Promise<void> };

export type MessagingDeps = {
  databaseUrl: string;
  provider: MessagingProvider;
  now: () => Date;
  origin: string;
  extractor: BookingExtractor;
  linkReader: LinkReader;
  mediaStore: MediaStore;
  supportEmail: string;
};

/** Default link reader: the existing SSRF-guarded preview. It yields a page title and description, which is rarely a whole booking; unreadable links fall back to the secure page. */
const defaultLinkReader: LinkReader = async url => {
  try { const preview = await previewExternalLink(url); return [preview.title, preview.description].filter(Boolean).join("\n") || null; } catch { return null; }
};

let testOverrides: Partial<MessagingDeps> | null = null;
/** Test seam: dependencies the tests replace (clock, extractor, media store, origin). Production code never calls this. */
export function setMessagingDepsForTests(overrides: Partial<MessagingDeps> | null) { testOverrides = overrides; }

/**
 * `allowNoProvider` is for the secure review page, which reviews and saves a booking without the texting channel. It gets a stand-in that can
 * never send or verify anything.
 */
export async function messagingDeps(options: { allowNoProvider?: boolean } = {}): Promise<MessagingDeps> {
  const provider = testOverrides?.provider ?? await messagingProvider() ?? (options.allowNoProvider ? unconfiguredProvider : null);
  if (!provider) throw new MessagingUnavailableError("No messaging provider is configured.");
  return {
    databaseUrl: requireCommonsDatabaseUrl(),
    provider,
    now: () => new Date(),
    origin: commonsSiteOrigin(),
    extractor: deterministicExtractor,
    linkReader: defaultLinkReader,
    mediaStore: { put: storeCommonsConfirmationAsset },
    supportEmail: instanceSettings().contactEmail ?? "the trip organizer",
    ...testOverrides,
  };
}
export class MessagingUnavailableError extends Error {}

export const dbOptions = (deps: MessagingDeps) => ({ databaseUrl: deps.databaseUrl, now: deps.now() });

export type Person = { id: string; name: string };
export type Conversation = { deps: MessagingDeps; e164: string; phoneHash: string; person: Person; trips: EnrolledTrip[]; message: MessageRow };

export const firstName = (name: string) => name.trim().split(/\s+/)[0] || "there";
export const tripUrl = (deps: MessagingDeps, trip: Pick<EnrolledTrip, "id">, view: Parameters<typeof commonsViewPath>[1] = "home") => `${deps.origin}${commonsViewPath(trip.id, view)}`;
export const stable = (...parts: Array<string | number | null | undefined>) => createHash("sha256").update(parts.map(part => String(part ?? "")).join("|")).digest("hex").slice(0, 24);

/**
 * The words for where a message goes: a web thread gets the same messages without "text me", a number to save or a carrier STOP line. Only
 * Commons's own words change; every value in a message (names, poll titles, an organizer's note, the saved plan) arrives exactly as written.
 */
export const copyFor = (address: string): MessagingCopy => isWebAddress(address) ? webMessagingCopy : messagingCopy;

/**
 * Queue one message. Purposes: `reply:*` answers something the person just sent, `compliance:*` is required opt-out/help text, and `proactive:*`
 * is anything Commons starts, which is the only kind subject to quiet hours and cadence. The key makes queueing the same step twice a no-op.
 */
export async function queue(conversation: { deps: MessagingDeps; e164: string; person: Person | null }, input: { key: string; purpose: string; body: string; tripId?: string | null; questionId?: string | null; notBefore?: Date }) {
  const { deps } = conversation, body = input.body;
  // The body is sent as written. Its words already fit the channel (copyFor), so nothing here rewrites what a person or the plan said.
  const web = isWebAddress(conversation.e164);
  return enqueueOutbound({ provider: web ? "web" : deps.provider.name, idempotencyKey: input.key, e164: conversation.e164, personId: conversation.person?.id ?? null, commonsId: input.tripId ?? null, purpose: input.purpose, body, questionId: input.questionId ?? null, segments: web ? 0 : smsSegments(body), notBefore: input.notBefore }, dbOptions(deps));
}

export class SnapshotUnavailableError extends Error {}
/** The person's own, permission-filtered view of a trip. Never a broader read; null (no access) is an error, not an empty trip. */
export async function snapshotOf(deps: MessagingDeps, slug: string, personId: string) {
  const snapshot = await getCommonsSnapshot(slug, { databaseUrl: deps.databaseUrl, actorPersonId: personId });
  if (!snapshot) throw new SnapshotUnavailableError();
  return snapshot;
}
