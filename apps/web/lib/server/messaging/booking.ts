import { createHash, randomBytes } from "node:crypto";
import { ConfirmationDraftSchema, type ConfirmationDraft } from "@commons/contracts";
import {
  addCommonsStay, beginConfirmationIntake, claimIntakeApproval, closeQuestion, createIntake, deleteCommonsTravelPlan, finishConfirmationIntake, getOwnIntake, listConfirmationIntakes,
  openQuestion, updateCommonsStay, updateIntake, upsertCommonsFlightBooking, upsertCommonsTravelPlan, openQuestionsForPerson, type BookingIntakeRow, type EnrolledTrip,
} from "@commons/database";
import {
  applyFocusedAnswer, approvalCode, bookingMissing, bookingSummaryLines, bookingUncertainty, classifyBooking, extractLinks, looksLikeBooking, parseApproval, QUESTION_TTL_MS, sanitizeInbound, sharingLine,
} from "@commons/domain";
import { readUploadedFile } from "@/lib/import/read-uploaded-file";
import { copyFor, dbOptions, queue, snapshotOf, tripUrl, type Conversation, type MessagingDeps, type Person } from "./core";
import { deterministicUuid, digestOf } from "./extraction";

/*
 * Booking intake (BR-05). Four things stay separate: the message was RECEIVED, details were EXTRACTED, the person REVIEWED an exact version, and
 * only then are facts SAVED through the existing Plan commands. Nothing a message says is obeyed; it is parsed into a schema-checked draft.
 */
const SUPPORTED_MEDIA: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };
const MAX_BYTES = 10 * 1024 * 1024;

export class NeedsReviewPageError extends Error {}

export const newReviewToken = () => randomBytes(24).toString("base64url");
export const hashReviewToken = (token: string) => createHash("sha256").update(token).digest("hex");
export const reviewUrl = (deps: MessagingDeps, token: string) => `${deps.origin}/messages/review/${token}`;

const actor = (deps: MessagingDeps, person: Person) => ({ databaseUrl: deps.databaseUrl, actorPersonId: person.id });

export type IntakeSource =
  | { kind: "text"; text: string }
  | { kind: "link"; url: string }
  | { kind: "file"; bytes: Uint8Array; mimeType: string; fileName: string };

export type IntakeOutcome =
  | { kind: "unreadable"; intake: BookingIntakeRow; reason: "no_booking_found" | "unsupported_file" | "link_unreadable" | "file_too_large" | "storage_failed" }
  | { kind: "needs_info"; intake: BookingIntakeRow; question: string }
  | { kind: "duplicate"; intake: BookingIntakeRow }
  | { kind: "not_permitted"; intake: BookingIntakeRow; reason: "stay_needs_organizer" }
  | { kind: "in_progress"; intake: BookingIntakeRow }
  | { kind: "review"; intake: BookingIntakeRow; draft: ConfirmationDraft; code: string; token: string; classification: "new" | "change" | "cancellation"; lines: string[]; uncertain: string[]; sharing: string };

/** A fresh secure link for this intake. Only its hash is stored; a newer link invalidates the older one. */
export async function issueReviewToken(deps: MessagingDeps, intake: BookingIntakeRow) {
  const token = newReviewToken();
  const row = await updateIntake(intake.id, intake.version, { reviewTokenHash: hashReviewToken(token), reviewExpiresAt: new Date(deps.now().getTime() + 7 * 86_400_000) }, dbOptions(deps));
  return row ? { token, intake: row } : null;
}

async function supersedeOthers(deps: MessagingDeps, person: Person, trip: Pick<EnrolledTrip, "id">, keepId: string | null) {
  const open = (await openQuestionsForPerson(person.id, dbOptions(deps))).filter(question => question.commonsId === trip.id && ["booking_review", "booking_info"].includes(question.kind));
  for (const question of open) {
    if (keepId && question.refId?.startsWith(keepId)) continue;
    await closeQuestion(question.id, "superseded", null, dbOptions(deps));
    const id = question.refId?.split(":")[0];
    const intake = id ? await getOwnIntake(id, person.id, dbOptions(deps)) : null;
    if (intake && ["awaiting_review", "needs_info"].includes(intake.status)) await updateIntake(intake.id, intake.version, { status: "superseded" }, dbOptions(deps));
  }
}

/**
 * Create or resume the intake for this source and drive it as far as it can go without the person: extraction, completeness, duplicate check and the
 * review summary. It never saves. A repeat of the same source returns the earlier outcome instead of creating a second record.
 */
export async function runIntake(deps: MessagingDeps, person: Person, trip: EnrolledTrip, source: IntakeSource, context: { receivedMessageId?: string | null; intakeId?: string } = {}): Promise<IntakeOutcome> {
  const sourceLabel = source.kind === "text" ? "Text message" : source.kind === "link" ? "Link in a text message" : source.fileName.slice(0, 120);
  const text = source.kind === "text" ? sanitizeInbound(source.text) : null;
  const digest = source.kind === "text" ? digestOf(trip.id, text!.trim()) : source.kind === "link" ? digestOf(trip.id, source.url) : digestOf(trip.id, source.bytes);
  let intake: BookingIntakeRow;
  if (context.intakeId) {
    // The secure page owns an intake row created when its link was issued; a new source replaces what it holds.
    const own = await getOwnIntake(context.intakeId, person.id, dbOptions(deps));
    if (!own || own.commonsId !== trip.id) throw new Error("intake_not_found");
    const rekeyed = await updateIntake(own.id, own.version, { sourceText: text, status: "received", draft: null, classification: null, uncertainty: [] }, { ...dbOptions(deps), bumpVersion: true });
    if (!rekeyed) throw new Error("intake_changed");
    intake = rekeyed;
  } else {
    const created = await createIntake({ personId: person.id, commonsId: trip.id, source: source.kind === "file" ? (source.mimeType === "application/pdf" ? "upload" : "mms") : source.kind, sourceDigest: digest, sourceText: text, sourceUrl: source.kind === "link" ? source.url : null, receivedMessageId: context.receivedMessageId ?? null }, dbOptions(deps));
    intake = created.intake;
    if (!created.created) {
      if (intake.status === "awaiting_review" || intake.status === "needs_info") return { kind: "in_progress", intake };
      if (intake.status === "saved" || intake.errorCode === "duplicate_of_saved") return { kind: "duplicate", intake };
      // Failed, declined or superseded: the same source is tried again as a new version.
      const again = await updateIntake(intake.id, intake.version, { status: "received", errorCode: null, draft: null, classification: null, uncertainty: [] }, { ...dbOptions(deps), bumpVersion: true });
      if (!again) return { kind: "in_progress", intake };
      intake = again;
    }
  }
  const extracting = await updateIntake(intake.id, intake.version, { status: "extracting" }, dbOptions(deps));
  if (!extracting) return { kind: "in_progress", intake };
  intake = extracting;

  const fail = async (reason: Extract<IntakeOutcome, { kind: "unreadable" }>["reason"]): Promise<IntakeOutcome> => {
    const failed = (await updateIntake(intake.id, intake.version, { status: "failed", errorCode: reason }, dbOptions(deps))) ?? intake;
    return { kind: "unreadable", intake: failed, reason };
  };

  let draft: ConfirmationDraft | null = null;
  let evidenceText = text ?? "";
  let file: { storagePath: string; mimeType: string; fileName: string } | null = null;
  try {
    if (source.kind === "text") draft = await deps.extractor.fromText({ text: text!, sourceLabel });
    else if (source.kind === "link") {
      const page = await deps.linkReader(source.url);
      if (!page) return fail("link_unreadable");
      evidenceText = sanitizeInbound(page);
      draft = await deps.extractor.fromText({ text: evidenceText, sourceLabel });
      if (!draft) return fail("link_unreadable");
    } else {
      if (!SUPPORTED_MEDIA[source.mimeType]) return fail("unsupported_file");
      if (source.bytes.byteLength > MAX_BYTES) return fail("file_too_large");
      if (source.mimeType === "application/pdf") {
        const read = await readUploadedFile(new File([Uint8Array.from(source.bytes)], source.fileName, { type: source.mimeType }));
        evidenceText = sanitizeInbound(read.text);
        draft = evidenceText.trim() ? await deps.extractor.fromText({ text: evidenceText, sourceLabel }) : null;
      } else draft = await deps.extractor.fromImage({ bytes: source.bytes, mimeType: source.mimeType, sourceLabel });
      if (draft) {
        // Reuse the existing private confirmation intake and storage. The original stays private to this person.
        // The shape the existing confirmation storage requires: <trip>/<owner>/<64-hex digest>.<ext>.
        const storagePath = `${trip.slug}/${person.id}/${digest}.${SUPPORTED_MEDIA[source.mimeType]}`;
        try { await deps.mediaStore.put(storagePath, source.bytes, source.mimeType); } catch { return fail("storage_failed"); }
        const begun = await beginConfirmationIntake(trip.slug, { digest, kind: draft.kind, storagePath, fileName: source.fileName, mimeType: source.mimeType }, { ...actor(deps, person), now: deps.now() });
        if (begun.claimed) await finishConfirmationIntake(trip.slug, begun.intake.id, begun.intake.revision, { draft }, { ...actor(deps, person), now: deps.now() });
        file = { storagePath, mimeType: source.mimeType, fileName: source.fileName };
        intake = (await updateIntake(intake.id, intake.version, { storagePath, mimeType: source.mimeType, confirmationIntakeId: begun.intake.id }, dbOptions(deps))) ?? intake;
      }
    }
  } catch { return fail(source.kind === "link" ? "link_unreadable" : "no_booking_found"); }
  if (!draft) return fail("no_booking_found");
  void file;
  return finalizeDraft(deps, person, trip, intake, draft, evidenceText, { keepToken: Boolean(context.intakeId) });
}

/** Decide, from a schema-valid draft, whether to ask one more question, say it is a duplicate, or present it for review. */
export async function finalizeDraft(deps: MessagingDeps, person: Person, trip: EnrolledTrip, intake: BookingIntakeRow, draftInput: ConfirmationDraft, evidenceText: string, options: { keepToken?: boolean } = {}): Promise<IntakeOutcome> {
  const draft = ConfirmationDraftSchema.parse(draftInput);
  // Lodging is organizer-managed on the trip today. A traveler's stay confirmation is not turned into a record they could not make themselves.
  if (draft.kind === "stay" && trip.role !== "organizer") {
    const row = await updateIntake(intake.id, intake.version, { status: "declined", draft, errorCode: "stay_needs_organizer" }, dbOptions(deps));
    return { kind: "not_permitted", intake: row ?? intake, reason: "stay_needs_organizer" };
  }
  const uncertain = bookingUncertainty(draft);
  const missing = bookingMissing(draft);
  if (missing.length) {
    await supersedeOthers(deps, person, trip, intake.id);
    const row = await updateIntake(intake.id, intake.version, { status: "needs_info", draft, uncertainty: uncertain, sourceText: intake.sourceText ?? evidenceText.slice(0, 60_000) }, dbOptions(deps));
    if (!row) return { kind: "in_progress", intake };
    await openQuestion({ personId: person.id, commonsId: trip.id, kind: "booking_info", refId: `${row.id}:${missing[0]!.field}`, version: String(row.version), expiresAt: new Date(deps.now().getTime() + QUESTION_TTL_MS) }, dbOptions(deps));
    return { kind: "needs_info", intake: row, question: missing[0]!.question };
  }
  const snapshot = await snapshotOf(deps, trip.slug, person.id);
  const found = classifyBooking(draft, { plans: snapshot.state.travelPlans ?? [], stays: snapshot.state.stays ?? [] }, person.id, evidenceText);
  if (found.classification === "duplicate") {
    const row = await updateIntake(intake.id, intake.version, { status: "declined", draft, classification: "duplicate", errorCode: "duplicate_of_saved", uncertainty: uncertain }, dbOptions(deps));
    return { kind: "duplicate", intake: row ?? intake };
  }
  await supersedeOthers(deps, person, trip, intake.id);
  // The secure page keeps the link it was opened with; a text gets a fresh one (only a hash is stored, so an old link cannot be re-sent).
  const issued = newReviewToken();
  const tokenPatch = options.keepToken && intake.reviewTokenHash ? {} : { reviewTokenHash: hashReviewToken(issued), reviewExpiresAt: new Date(deps.now().getTime() + 7 * 86_400_000) };
  const row = await updateIntake(intake.id, intake.version, { status: "awaiting_review", draft, classification: found.classification, matchedPlanId: found.matchedPlanIds[0] ?? found.matchedStayId ?? null, uncertainty: uncertain, ...tokenPatch, sourceText: intake.sourceText ?? evidenceText.slice(0, 60_000) }, dbOptions(deps));
  if (!row) return { kind: "in_progress", intake };
  const code = approvalCode(row.id, row.version);
  await openQuestion({ personId: person.id, commonsId: trip.id, kind: "booking_review", refId: row.id, version: String(row.version), approvalCode: code, expiresAt: new Date(deps.now().getTime() + QUESTION_TTL_MS) }, dbOptions(deps));
  return { kind: "review", intake: row, draft, code, token: issued, classification: found.classification, lines: bookingSummaryLines(draft), uncertain, sharing: sharingLine(draft) };
}

/** The person answered the one focused question. The draft changes, the version advances, and so does the approval code. */
export async function answerBookingInfo(c: Conversation, trip: EnrolledTrip, question: { id: string; refId: string | null; version: string }): Promise<IntakeOutcome | { kind: "unparsed"; question: string } | null> {
  const [intakeId, field] = (question.refId ?? "").split(":");
  const intake = intakeId ? await getOwnIntake(intakeId, c.person.id, dbOptions(c.deps)) : null;
  if (!intake || intake.status !== "needs_info" || !intake.draft || String(intake.version) !== question.version) return null;
  const next = applyFocusedAnswer(intake.draft, field as Parameters<typeof applyFocusedAnswer>[1], sanitizeInbound(c.message.body, 300), trip.startsOn ?? undefined);
  if (!next) return { kind: "unparsed", question: bookingMissing(intake.draft).find(item => item.field === field)?.question ?? "I didn't catch that. Could you say it again?" };
  await closeQuestion(question.id, "answered", null, dbOptions(c.deps));
  const bumped = await updateIntake(intake.id, intake.version, { status: "extracting", draft: next }, { ...dbOptions(c.deps), bumpVersion: true });
  if (!bumped) return null;
  return finalizeDraft(c.deps, c.person, trip, bumped, next, intake.sourceText ?? "");
}

// ---- Saving ---------------------------------------------------------------------------------------------------------------------------------------

export type SaveResult = "saved" | "updated" | "removed";

/**
 * Apply an approved intake through the existing Plan commands. The classification is recomputed from the person's current records, so an approval
 * never applies a change against a plan that moved since the summary was shown. Every command id is derived from the intake and its version, so a
 * retry replays its receipt instead of saving twice.
 */
export async function saveApprovedIntake(deps: MessagingDeps, person: Person, trip: Pick<EnrolledTrip, "id" | "slug">, intake: BookingIntakeRow): Promise<SaveResult> {
  const draft = ConfirmationDraftSchema.parse(intake.draft);
  const options = actor(deps, person), seed = `intake:${intake.id}:${intake.version}`;
  const snapshot = await snapshotOf(deps, trip.slug, person.id);
  const saved = { plans: snapshot.state.travelPlans ?? [], stays: snapshot.state.stays ?? [] };
  const found = classifyBooking(draft, saved, person.id, intake.sourceText ?? "");
  if (found.classification === "duplicate") return "updated";

  if (found.classification === "cancellation") {
    if (draft.kind === "stay") throw new NeedsReviewPageError("A stay cancellation is removed from the Travel page.");
    for (const planId of found.matchedPlanIds) await deleteCommonsTravelPlan(trip.slug, { commandId: deterministicUuid(`${seed}:remove:${planId}`), travelPlanId: planId }, options);
    return "removed";
  }

  let document: { intakeId: string; intakeVersion: number; storagePath: string; fileName: string; mimeType: "application/pdf" | "image/jpeg" | "image/png" | "image/webp" } | undefined;
  if (intake.confirmationIntakeId && intake.storagePath && intake.mimeType) {
    const rows = await listConfirmationIntakes(trip.slug, { ...options, now: deps.now() });
    const row = rows.find(item => item.id === intake.confirmationIntakeId && item.status === "awaiting_review");
    if (row) document = { intakeId: row.id, intakeVersion: row.revision, storagePath: row.storagePath, fileName: row.fileName, mimeType: row.mimeType as NonNullable<typeof document>["mimeType"] };
  }
  const change = found.classification === "change";

  if (draft.kind === "flight") {
    const legs = (draft.travelSegments ?? []).map(segment => ({ kind: segment.kind, date: segment.date!, route: segment.route!, time: segment.time!, ...(segment.connections?.length ? { connections: segment.connections } : {}) }));
    const owned = saved.plans.filter(plan => plan.personId === person.id && ["arrival", "departure"].includes(plan.kind));
    await upsertCommonsFlightBooking(trip.slug, {
      commandId: deterministicUuid(`${seed}:flight`), legs, includedPersonIds: [person.id], note: (draft.note ?? "").slice(0, 120), confirmationCode: draft.confirmationCode, currency: draft.currency,
      ...(change && owned.length ? { expectedPlanVersions: owned.map(plan => ({ id: plan.id, version: plan.version! })) } : {}), ...(document ? { confirmationDocument: document } : {}),
    }, options);
    return change ? "updated" : "saved";
  }
  if (draft.kind === "stay") {
    const fields = {
      commandId: deterministicUuid(`${seed}:stay`), name: draft.name!, address: draft.address ?? "", startsOn: draft.startsOn!, endsOn: draft.endsOn!, timezone: null, checkInTime: draft.startTime, checkOutTime: draft.endTime,
      status: "confirmed" as const, includedPersonIds: [person.id], confirmationCode: draft.confirmationCode, totalCents: draft.totalCents, currency: draft.currency,
      costSource: draft.totalCents ? ("confirmation" as const) : null, includesTaxesAndFees: draft.includesTaxesAndFees, ...(document ? { confirmationDocument: document } : {}),
    };
    if (change && found.matchedStayId) await updateCommonsStay(trip.slug, found.matchedStayId, fields, options);
    else await addCommonsStay(trip.slug, fields, options);
    return change ? "updated" : "saved";
  }
  await upsertCommonsTravelPlan(trip.slug, {
    commandId: deterministicUuid(`${seed}:rental`), travelPlanId: change ? found.matchedPlanIds[0] ?? null : null, kind: "car_rental", date: draft.startsOn!, route: draft.route!, time: draft.startTime, note: "",
    companionPersonId: null, provider: draft.name, vehicle: draft.note, returnDate: draft.endsOn, returnTime: draft.endTime, status: "confirmed", confirmationCode: draft.confirmationCode, totalCents: draft.totalCents,
    currency: draft.currency, ...(document ? { confirmationDocument: document } : {}),
  }, options);
  return change ? "updated" : "saved";
}

/**
 * Approval is one atomic claim of one exact version. If saving then fails, the claim is released so the person can try again; a second approval
 * that arrives while the first is saving finds nothing to claim.
 */
export async function approveIntake(deps: MessagingDeps, person: Person, trip: Pick<EnrolledTrip, "id" | "slug">, intakeId: string, version: number, via: "sms" | "web"): Promise<{ ok: true; result: SaveResult } | { ok: false; reason: "stale" | "needs_page" | "failed" }> {
  const claimed = await claimIntakeApproval(intakeId, version, via, dbOptions(deps));
  if (!claimed || claimed.personId !== person.id || claimed.commonsId !== trip.id) return { ok: false, reason: "stale" };
  try {
    const result = await saveApprovedIntake(deps, person, trip, claimed);
    await updateIntake(claimed.id, claimed.version, { status: "saved", savedAt: deps.now() }, dbOptions(deps));
    const open = (await openQuestionsForPerson(person.id, dbOptions(deps))).find(question => question.refId === claimed.id && question.kind === "booking_review");
    if (open) await closeQuestion(open.id, "answered", "saved", dbOptions(deps));
    return { ok: true, result };
  } catch (error) {
    // Content-free: the error's name and message come from the Plan commands, never from the message text.
    console.warn("commons.messaging.save_failed", { intakeId: claimed.id, error: error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 200) : "unknown" });
    await updateIntake(claimed.id, claimed.version, { approvedAt: null, approvedVia: null }, dbOptions(deps));
    return { ok: false, reason: error instanceof NeedsReviewPageError ? "needs_page" : "failed" };
  }
}

export async function declineIntake(deps: MessagingDeps, person: Person, intakeId: string, version: number) {
  const intake = await getOwnIntake(intakeId, person.id, dbOptions(deps));
  if (!intake || intake.version !== version || !["awaiting_review", "needs_info"].includes(intake.status)) return false;
  await updateIntake(intake.id, intake.version, { status: "declined" }, dbOptions(deps));
  const open = (await openQuestionsForPerson(person.id, dbOptions(deps))).filter(question => question.refId?.startsWith(intake.id));
  for (const question of open) await closeQuestion(question.id, "cancelled", "declined", dbOptions(deps));
  return true;
}

// ---- SMS surface ------------------------------------------------------------------------------------------------------------------------------------

/** Send the right text for an outcome. The receipt, the question and the review are separate messages with separate keys. */
export async function replyForOutcome(c: Conversation, trip: EnrolledTrip, outcome: IntakeOutcome) {
  const key = (suffix: string) => `reply:${c.message.id}:${suffix}`;
  const send = (suffix: string, body: string) => queue(c, { key: key(suffix), purpose: `reply:intake_${suffix}`, body, tripId: trip.id });
  if (outcome.kind === "review") {
    await send("review", copyFor(c.e164).review({ tripName: trip.name, lines: outcome.lines, sharing: outcome.sharing, uncertain: outcome.uncertain, classification: outcome.classification, code: outcome.code, reviewUrl: reviewUrl(c.deps, outcome.token) }));
  } else if (outcome.kind === "needs_info") await send("question", `${trip.name}: ${outcome.question}`);
  else if (outcome.kind === "duplicate") await send("duplicate", copyFor(c.e164).duplicate(trip.name));
  else if (outcome.kind === "not_permitted") await send("not_permitted", copyFor(c.e164).stayNeedsOrganizer(trip.name));
  else if (outcome.kind === "in_progress") {
    const code = outcome.intake.status === "awaiting_review" ? approvalCode(outcome.intake.id, outcome.intake.version) : null;
    await send("progress", code ? `${copyFor(c.e164).duplicateSource(trip.name)} Reply SAVE ${code} to save it.` : copyFor(c.e164).duplicateSource(trip.name));
  } else {
    const issued = await issueReviewToken(c.deps, outcome.intake);
    const url = issued ? reviewUrl(c.deps, issued.token) : tripUrl(c.deps, trip, "logistics");
    await send("unreadable", outcome.reason === "unsupported_file" ? copyFor(c.e164).mediaUnsupported(trip.name, url) : outcome.reason === "link_unreadable" ? copyFor(c.e164).linkUnreadable(trip.name, url) : copyFor(c.e164).notReadable(trip.name, url));
  }
}

/**
 * Handle a message that carries booking material. Returns false when it carries none, so the caller can treat it as ordinary conversation.
 * Pasted text and links come first; a picture or PDF is read when the provider supports media and an extractor can read it, otherwise it
 * falls back to the secure page. Receipt is acknowledged separately for work that takes time.
 */
export async function handleBookingMessage(c: Conversation, trip: EnrolledTrip): Promise<boolean> {
  const body = sanitizeInbound(c.message.body);
  const media = c.message.media ?? [];
  if (media.length) {
    await queue(c, { key: `reply:${c.message.id}:receipt`, purpose: "reply:intake_receipt", body: copyFor(c.e164).receipt(trip.name, media[0]!.contentType === "application/pdf" ? "file" : "picture"), tripId: trip.id });
    const first = media[0]!;
    if (!c.deps.provider.supportsMedia || !c.deps.provider.fetchMedia) { await replyForOutcome(c, trip, await unreadableOutcome(c, trip, "unsupported_file")); return true; }
    let fetched: { bytes: Uint8Array; contentType: string };
    try { fetched = await c.deps.provider.fetchMedia(first); } catch { await replyForOutcome(c, trip, await unreadableOutcome(c, trip, "unsupported_file")); return true; }
    const outcome = await runIntake(c.deps, c.person, trip, { kind: "file", bytes: fetched.bytes, mimeType: fetched.contentType.split(";")[0]!.trim().toLowerCase(), fileName: `text-message-${c.message.id.slice(0, 8)}.${SUPPORTED_MEDIA[fetched.contentType.split(";")[0]!.trim().toLowerCase()] ?? "bin"}` }, { receivedMessageId: c.message.id });
    await replyForOutcome(c, trip, outcome);
    return true;
  }
  const links = extractLinks(body);
  if (links.length && !looksLikeBooking(body)) {
    await queue(c, { key: `reply:${c.message.id}:receipt`, purpose: "reply:intake_receipt", body: copyFor(c.e164).receipt(trip.name, "link"), tripId: trip.id });
    await replyForOutcome(c, trip, await runIntake(c.deps, c.person, trip, { kind: "link", url: links[0]! }, { receivedMessageId: c.message.id }));
    return true;
  }
  if (!looksLikeBooking(body)) return false;
  await replyForOutcome(c, trip, await runIntake(c.deps, c.person, trip, { kind: "text", text: body }, { receivedMessageId: c.message.id }));
  return true;
}

async function unreadableOutcome(c: Conversation, trip: EnrolledTrip, reason: "unsupported_file"): Promise<IntakeOutcome> {
  const created = await createIntake({ personId: c.person.id, commonsId: trip.id, source: "upload", sourceDigest: digestOf(trip.id, c.message.id), receivedMessageId: c.message.id }, dbOptions(c.deps));
  const failed = (await updateIntake(created.intake.id, created.intake.version, { status: "failed", errorCode: reason }, dbOptions(c.deps))) ?? created.intake;
  return { kind: "unreadable", intake: failed, reason };
}

/** A text reply while a review is pending: SAVE <code>, or NO. Anything else leaves the review untouched and says how to approve. */
export async function answerBookingReview(c: Conversation, trip: EnrolledTrip, question: { id: string; refId: string | null; version: string; approvalCode: string | null }) {
  const approval = parseApproval(c.message.body);
  const send = (suffix: string, body: string) => queue(c, { key: `reply:${c.message.id}:${suffix}`, purpose: `reply:review_${suffix}`, body, tripId: trip.id });
  const intake = question.refId ? await getOwnIntake(question.refId, c.person.id, dbOptions(c.deps)) : null;
  if (!intake || String(intake.version) !== question.version || intake.status !== "awaiting_review") { await send("stale", copyFor(c.e164).versionChanged(trip.name)); await closeQuestion(question.id, "superseded", null, dbOptions(c.deps)); return; }
  if (approval.action === "decline") { await declineIntake(c.deps, c.person, intake.id, intake.version); await send("discarded", copyFor(c.e164).reviewDiscarded(trip.name)); return; }
  if (approval.action !== "save") { await send("remind", `${trip.name}: to save, reply SAVE ${question.approvalCode}. Reply DISCARD to drop it.`); return; }
  const result = await approveIntake(c.deps, c.person, trip, intake.id, intake.version, "sms");
  if (result.ok) { await send("saved", copyFor(c.e164).reviewSaved(trip.name, result.result)); return; }
  const page = await issueReviewToken(c.deps, (await getOwnIntake(intake.id, c.person.id, dbOptions(c.deps))) ?? intake);
  const url = page ? reviewUrl(c.deps, page.token) : tripUrl(c.deps, trip, "logistics");
  await send(result.reason, result.reason === "needs_page" ? copyFor(c.e164).reviewNeedsPage(trip.name, url) : result.reason === "stale" ? copyFor(c.e164).versionChanged(trip.name) : copyFor(c.e164).reviewFailed(trip.name, url));
}
