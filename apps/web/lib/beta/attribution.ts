/**
 * Privacy-safe attribution (BR-09). An entry is a kind plus an optional catalog slug, nothing else: no person, contact, name, free text, query
 * string, address or referrer. Anything that does not match the allowlist becomes "unknown".
 */
export const ENTRY_KINDS = ["direct", "template", "destination", "assistant", "partner", "recap", "unknown"] as const;
export type EntryKind = (typeof ENTRY_KINDS)[number];
export type AttributionEventName = "draft_started" | "approved" | "paid_activation" | "traveler_participation" | "traveler_to_organizer";
export const ATTRIBUTION_EVENTS: AttributionEventName[] = ["draft_started", "approved", "paid_activation", "traveler_participation", "traveler_to_organizer"];

const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;

export function sanitizeEntry(kind: unknown, ref?: unknown): { entryKind: EntryKind; entryRef: string | null } {
  const entryKind = (ENTRY_KINDS as readonly unknown[]).includes(kind) ? (kind as EntryKind) : "unknown";
  const entryRef = entryKind !== "direct" && entryKind !== "unknown" && typeof ref === "string" && SLUG.test(ref) ? ref : null;
  return { entryKind, entryRef };
}

/** Reads `?from=template:girls-trip` style values. A malformed value is "unknown" rather than an error. */
export function entryFromParam(value: string | null | undefined) {
  if (!value) return sanitizeEntry("direct");
  const [kind, ref] = value.split(":", 2);
  return sanitizeEntry(kind, ref);
}

/** The saved entry context on a draft, reduced to one allowlisted kind and catalog slug. */
export function entryFromContext(context: { template?: unknown; destination?: unknown; source?: unknown } | null | undefined) {
  if (context?.template) return sanitizeEntry("template", context.template);
  if (context?.destination) return sanitizeEntry("destination", context.destination);
  if (context?.source === "assistants") return sanitizeEntry("assistant");
  if (context?.source === "recap") return sanitizeEntry("recap");
  return sanitizeEntry("direct");
}

/** Subject keys are an opaque trip or draft id. A key shorter than eight characters or with whitespace is refused. */
export function validSubjectKey(value: string) {
  return value.length >= 8 && value.length <= 80 && /^[A-Za-z0-9_-]+$/.test(value);
}
