import { createHash } from "node:crypto";
import { z } from "zod";

/**
 * Partner inquiry capture (BR-09, app side). A DMO or travel assistant tells Commons who they are and what they want to talk about. The
 * capture validates, rate limits, resists spam, stores, and routes to one configured operator address. It reads and writes no trip data,
 * and delivery state is whatever the route really did.
 */
export const INQUIRY_LIMITS = { perClientPerHour: 3, globalPerHour: 60 } as const;

const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const optionalText = (max: number) => z.string().trim().max(max).optional().transform(value => value || null);

export const PartnerInquirySchema = z.object({
  kind: z.enum(["dmo", "travel_assistant"]),
  organization: text(1, 160),
  contactName: text(1, 120),
  contactEmail: z.string().trim().toLowerCase().email().max(254),
  website: optionalText(200).refine(value => value === null || /^https?:\/\/[^\s]+$/i.test(value), "Use a full web address."),
  region: optionalText(120),
  message: text(10, 2000),
  sourcePath: z.string().trim().max(200).startsWith("/").default("/"),
  idempotencyKey: z.string().uuid(),
  /** Honeypot: a field people never see. A bot that fills it gets a success response and nothing is stored. */
  fax: z.string().max(200).optional(),
  /** Milliseconds since the form rendered. A submission faster than a person can type is treated as automated. */
  elapsedMs: z.number().int().min(0).max(86_400_000).optional(),
});
export type PartnerInquiryInput = z.infer<typeof PartnerInquirySchema>;

/** The public path only: never a query string, which could carry a token. */
export function inquirySourcePath(value: string) {
  try {
    const url = new URL(value, "https://commons.invalid");
    if (url.origin !== "https://commons.invalid") return "/";
    return /^\/(join|poll|auth|sign-in)(\/|$)/.test(url.pathname) ? "/" : url.pathname.slice(0, 200);
  } catch { return "/"; }
}

const linkCount = (value: string) => (value.match(/https?:\/\//gi) ?? []).length;
const markup = /<\s*(script|a\s|iframe|img|svg|style|html|body)\b|\[url=|javascript:/i;

export type SpamVerdict = "ok" | "silent" | "reject";
export function inquirySpamVerdict(input: Pick<PartnerInquiryInput, "fax" | "elapsedMs" | "message" | "organization" | "contactName">): SpamVerdict {
  if (input.fax) return "silent";
  if (input.elapsedMs !== undefined && input.elapsedMs < 2_500) return "silent";
  const body = `${input.message}\n${input.organization}\n${input.contactName}`;
  if (linkCount(input.message) > 2 || markup.test(body)) return "reject";
  return "ok";
}

/** A salted hash of the caller's address. Only the hash is stored, only to rate limit. */
export function clientHash(forwardedFor: string | null, salt: string) {
  const first = (forwardedFor ?? "").split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(`${salt}:inquiry:${first}`).digest("hex").slice(0, 32);
}

export type InquiryRow = {
  id: string; kind: "dmo" | "travel_assistant"; organization: string; contactName: string; contactEmail: string;
  website: string | null; region: string | null; message: string; sourcePath: string;
};

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, ch => HTML_ESCAPES[ch]!);
// Line separators are built from code points so no invisible character sits in the source.
const LINE_BREAKS = new RegExp(`[\r\n${String.fromCharCode(0x2028)}${String.fromCharCode(0x2029)}]+`, "g");
const oneLine = (value: string) => value.replace(LINE_BREAKS, " ").slice(0, 160);

/** Plain text first. The HTML part is the same text, escaped; an inquiry cannot inject markup into the operator's inbox. */
export function renderInquiryEmail(row: InquiryRow) {
  const label = row.kind === "dmo" ? "Destination organization" : "Travel assistant";
  const lines = [
    `${label} inquiry`,
    "",
    `Organization: ${oneLine(row.organization)}`,
    `Contact: ${oneLine(row.contactName)} <${oneLine(row.contactEmail)}>`,
    ...(row.website ? [`Website: ${oneLine(row.website)}`] : []),
    ...(row.region ? [`Region: ${oneLine(row.region)}`] : []),
    `Sent from: ${row.sourcePath}`,
    "",
    row.message,
    "",
    `Inquiry ${row.id}. Reply goes to the contact above, not to this address.`,
  ];
  const textBody = lines.join("\n");
  return { subject: `Partner inquiry (${row.kind === "dmo" ? "DMO" : "assistant"}): ${oneLine(row.organization)}`.slice(0, 200), text: textBody, html: `<pre style="font:14px/1.5 Arial,Helvetica,sans-serif;white-space:pre-wrap">${escapeHtml(textBody)}</pre>` };
}

export type InquiryDeliveryDeps = {
  lease: (id: string) => Promise<(InquiryRow & { deliveryAttempts: number; routedTo: string | null }) | null>;
  complete: (id: string, attempt: number, result: { sent: true; providerMessageId: string } | { sent: false; errorCode: string }) => Promise<boolean>;
  send: (input: { to: string; subject: string; text: string; html: string; idempotencyKey: string }) => Promise<{ id: string }>;
};

/** One delivery attempt. The error recorded is a bounded classification, never provider text or the inquiry itself. */
export async function deliverInquiry(id: string, deps: InquiryDeliveryDeps) {
  const row = await deps.lease(id);
  if (!row || !row.routedTo) return { status: "skipped" as const };
  try {
    const sent = await deps.send({ ...renderInquiryEmail(row), to: row.routedTo, idempotencyKey: `commons-inquiry-${row.id}` });
    await deps.complete(row.id, row.deliveryAttempts, { sent: true, providerMessageId: sent.id });
    return { status: "sent" as const };
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && typeof (error as { code: unknown }).code === "string" ? (error as { code: string }).code : "provider_unavailable";
    await deps.complete(row.id, row.deliveryAttempts, { sent: false, errorCode: code });
    return { status: "failed" as const, code };
  }
}
