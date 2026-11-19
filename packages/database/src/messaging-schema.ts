import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { ConfirmationDraft } from "@commons/contracts";
import { commons, people } from "./schema";

/*
 * Traveler messaging (Beta Rework BR-04/BR-05). Additive only: nothing here is read or written unless COMMONS_BETA_REWORK_ENABLED is on, so
 * the tables sit empty and harmless in a live database with the flag off. Every table is server-mediated (RLS enabled, no client policies).
 * Message bodies and booking source text are private to the person they belong to; no organizer or operator projection reads them.
 */

const createdAt = timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();
const personRef = (name: string) => uuid(name).references((): AnyPgColumn => people.id, { onDelete: "cascade" });
const tripRef = (name: string) => uuid(name).references((): AnyPgColumn => commons.id, { onDelete: "cascade" });

/** One row per phone number Commons has seen, keyed by a hash. STOP is a property of the number, across every trip. */
export const messagingPhones = pgTable("messaging_phones", {
  phoneHash: text("phone_hash").primaryKey(),
  /** E.164 protected with the service token key; readable only by the sender. */
  phoneProtected: text("phone_protected").notNull(),
  optedOut: boolean("opted_out").notNull().default(false),
  optedOutAt: timestamp("opted_out_at", { withTimezone: true }),
  reenrolledAt: timestamp("reenrolled_at", { withTimezone: true }),
  /** The last time an unknown sender was sent the sign-in handoff; bounds that reply to one a day. */
  handoffSentAt: timestamp("handoff_sent_at", { withTimezone: true }),
  lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  createdAt, updatedAt,
}).enableRLS();

/** Scoped permission for one person on one trip. Phone verification alone never creates one; the web enrollment action does. */
export const messagingConsents = pgTable("messaging_consents", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: personRef("person_id").notNull(),
  commonsId: tripRef("commons_id").notNull(),
  /** The number consent was given for. A changed verified number no longer matches, so sending stops until the person re-enrolls. */
  phoneHash: text("phone_hash").notNull(),
  scope: text("scope").$type<"conversation" | "updates">().notNull(),
  status: text("status").$type<"granted" | "revoked">().notNull(),
  wording: text("wording").notNull(),
  method: text("method").$type<"web_enrollment" | "sms_reply" | "web_reply">().notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
  createdAt, updatedAt,
}, t => [
  uniqueIndex("messaging_consents_person_trip_scope").on(t.personId, t.commonsId, t.scope),
  index("messaging_consents_phone_idx").on(t.phoneHash, t.status),
  check("messaging_consents_status", sql`${t.status} in ('granted','revoked')`),
  check("messaging_consents_scope", sql`${t.scope} in ('conversation','updates')`),
]).enableRLS();

/** Every inbound and outbound message with its real status. `queued` is never `delivered`. */
export const messagingMessages = pgTable("messaging_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  direction: text("direction").$type<"inbound" | "outbound">().notNull(),
  provider: text("provider").notNull(),
  providerMessageId: text("provider_message_id"),
  /** Outbound dedupe: one stable key per accepted step (for example welcome:<membership>). */
  idempotencyKey: text("idempotency_key"),
  phoneHash: text("phone_hash").notNull(),
  personId: uuid("person_id").references((): AnyPgColumn => people.id, { onDelete: "set null" }),
  commonsId: uuid("commons_id").references((): AnyPgColumn => commons.id, { onDelete: "set null" }),
  purpose: text("purpose").notNull(),
  body: text("body").notNull(),
  mediaCount: integer("media_count").notNull().default(0),
  /** Provider media references for an inbound message (URL and type only). The bytes are fetched on demand and never stored here. */
  media: jsonb("media").$type<Array<{ url: string; contentType: string }>>().notNull().default([]),
  status: text("status").notNull(),
  statusDetail: text("status_detail"),
  attempts: integer("attempts").notNull().default(0),
  nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
  leaseUntil: timestamp("lease_until", { withTimezone: true }),
  segments: integer("segments").notNull().default(1),
  questionId: uuid("question_id"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  failedAt: timestamp("failed_at", { withTimezone: true }),
  createdAt, updatedAt,
}, t => [
  uniqueIndex("messaging_messages_provider_id").on(t.provider, t.direction, t.providerMessageId).where(sql`${t.providerMessageId} is not null`),
  uniqueIndex("messaging_messages_idempotency").on(t.idempotencyKey).where(sql`${t.idempotencyKey} is not null`),
  index("messaging_messages_ready_idx").on(t.status, t.nextAttemptAt),
  index("messaging_messages_person_idx").on(t.personId, t.createdAt),
  check("messaging_messages_direction", sql`${t.direction} in ('inbound','outbound')`),
  check("messaging_messages_status", sql`${t.status} in ('received','processed','ignored','held','queued','sending','sent','delivered','undelivered','failed','suppressed','cancelled')`),
  check("messaging_messages_bounds", sql`length(${t.body}) <= 4000 and ${t.attempts} >= 0 and ${t.mediaCount} >= 0`),
]).enableRLS();

/** Delivery dedupe: a provider event is processed once however many times it is redelivered. */
export const messagingWebhookEvents = pgTable("messaging_webhook_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  provider: text("provider").notNull(),
  eventKey: text("event_key").notNull(),
  kind: text("kind").$type<"inbound" | "status">().notNull(),
  messageId: uuid("message_id"),
  outcome: text("outcome").notNull().default("received"),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("messaging_webhook_events_key").on(t.provider, t.eventKey)]).enableRLS();

/** The one question a person may answer by text, pinned to the exact version it was asked under. */
export const messagingQuestions = pgTable("messaging_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: personRef("person_id").notNull(),
  commonsId: tripRef("commons_id").notNull(),
  kind: text("kind").$type<"attendance" | "attendance_decline" | "poll" | "arrival" | "trip_choice" | "booking_review" | "booking_info" | "money_review" | "money_info">().notNull(),
  /** Source record (poll id, booking intake id, …). */
  refId: text("ref_id"),
  /** What the question was asked about. A reply applies only while the source still reports this version. */
  version: text("version").notNull(),
  options: jsonb("options").$type<Array<{ key: string; label: string; value: string }>>().notNull().default([]),
  status: text("status").$type<"open" | "answered" | "superseded" | "expired" | "resolved_elsewhere" | "cancelled">().notNull().default("open"),
  /** For trip_choice: the inbound message held until the person picks a trip. */
  heldMessageId: uuid("held_message_id"),
  /** The value the person chose (a poll option id, "driving", "later", …), kept so a resolved task stays suppressed. */
  answer: text("answer"),
  /** For booking_review: the short code that must appear in an approving text. */
  approvalCode: text("approval_code"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt, updatedAt,
}, t => [
  index("messaging_questions_person_idx").on(t.personId, t.status),
  uniqueIndex("messaging_questions_one_open").on(t.personId, t.commonsId, t.kind, t.refId).where(sql`${t.status} = 'open'`),
  check("messaging_questions_status", sql`${t.status} in ('open','answered','superseded','expired','resolved_elsewhere','cancelled')`),
]).enableRLS();

/**
 * Booking details a person sent by text, link, picture or the secure page. Receipt, extraction, review and saved facts are separate states here;
 * only `saved` means the Plan changed. Source text is private to the sender and never copied into a shared projection.
 */
export const messagingBookingIntakes = pgTable("messaging_booking_intakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: personRef("person_id").notNull(),
  commonsId: tripRef("commons_id").notNull(),
  source: text("source").$type<"text" | "link" | "mms" | "upload">().notNull(),
  status: text("status").$type<"received" | "extracting" | "needs_info" | "awaiting_review" | "saved" | "declined" | "failed" | "superseded">().notNull().default("received"),
  /** Incremented by every re-extraction or correction; an approval is valid only for the version it names. */
  version: integer("version").notNull().default(1),
  sourceDigest: text("source_digest").notNull(),
  sourceText: text("source_text"),
  sourceUrl: text("source_url"),
  /** A confirmation_intakes row and storage path when the source was a file. */
  confirmationIntakeId: uuid("confirmation_intake_id"),
  storagePath: text("storage_path"),
  mimeType: text("mime_type"),
  receivedMessageId: uuid("received_message_id"),
  draft: jsonb("draft").$type<ConfirmationDraft>(),
  /** new | duplicate | change | cancellation, with the saved plan it matched. */
  classification: text("classification").$type<"new" | "duplicate" | "change" | "cancellation">(),
  matchedPlanId: uuid("matched_plan_id"),
  uncertainty: jsonb("uncertainty").$type<string[]>().notNull().default([]),
  reviewTokenHash: text("review_token_hash"),
  reviewExpiresAt: timestamp("review_expires_at", { withTimezone: true }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  approvedVia: text("approved_via").$type<"sms" | "web">(),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  errorCode: text("error_code"),
  createdAt, updatedAt,
}, t => [
  uniqueIndex("messaging_booking_intakes_digest").on(t.personId, t.commonsId, t.sourceDigest),
  uniqueIndex("messaging_booking_intakes_review_token").on(t.reviewTokenHash).where(sql`${t.reviewTokenHash} is not null`),
  index("messaging_booking_intakes_person_idx").on(t.personId, t.commonsId, t.status),
  check("messaging_booking_intakes_status", sql`${t.status} in ('received','extracting','needs_info','awaiting_review','saved','declined','failed','superseded')`),
  check("messaging_booking_intakes_source", sql`${t.source} in ('text','link','mms','upload')`),
  check("messaging_booking_intakes_bounds", sql`${t.version} > 0 and (${t.sourceText} is null or length(${t.sourceText}) <= 60000)`),
]).enableRLS();

/**
 * A code sent to prove a person controls a mobile number. Only an HMAC of the code is stored, and a message row never holds the code. Verifying a
 * number never grants consent to text it: consent stays per trip, in messaging_consents.
 */
export const messagingPhoneVerifications = pgTable("messaging_phone_verifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: personRef("person_id").notNull(),
  phoneHash: text("phone_hash").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt,
}, t => [
  index("messaging_phone_verifications_person_idx").on(t.personId, t.createdAt),
  index("messaging_phone_verifications_phone_idx").on(t.phoneHash, t.createdAt),
  index("messaging_phone_verifications_created_idx").on(t.createdAt),
  check("messaging_phone_verifications_attempts", sql`${t.attempts} >= 0`),
]).enableRLS();

/** What a person reported about money by text, waiting for their exact approval. Nothing here changes a balance; approving runs the existing Money command. */
export type MessagingMoneyDraft =
  | { kind: "expense"; description: string; amountCents: number; currency: string; occurredOn: string; dateAssumed: boolean; currencyAssumed: boolean; paidByPersonId: string; includedPersonIds: string[]; includedNames: string[]; everyone: boolean }
  | { kind: "payment"; amountCents: number; currency: string; toPersonId: string; toName: string; occurredOn: string };

export const messagingMoneyIntakes = pgTable("messaging_money_intakes", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: personRef("person_id").notNull(),
  commonsId: tripRef("commons_id").notNull(),
  status: text("status").$type<"needs_info" | "awaiting_review" | "saved" | "declined" | "superseded">().notNull(),
  /** Incremented by every correction; an approval is valid only for the version it names. */
  version: integer("version").notNull().default(1),
  sourceText: text("source_text").notNull(),
  /** What is known so far. Complete only once status is awaiting_review. */
  draft: jsonb("draft").$type<Partial<MessagingMoneyDraft> & { kind: "expense" | "payment" }>().notNull(),
  /** The fact still being asked for while status is needs_info. */
  missing: text("missing"),
  /** The saved expense or payment report, once approved. */
  recordId: uuid("record_id"),
  receivedMessageId: uuid("received_message_id"),
  createdAt, updatedAt,
}, t => [
  index("messaging_money_intakes_person_idx").on(t.personId, t.commonsId, t.status),
  uniqueIndex("messaging_money_intakes_message").on(t.receivedMessageId).where(sql`${t.receivedMessageId} is not null`),
  check("messaging_money_intakes_status", sql`${t.status} in ('needs_info','awaiting_review','saved','declined','superseded')`),
  check("messaging_money_intakes_bounds", sql`${t.version} > 0 and length(${t.sourceText}) <= 4000`),
]).enableRLS();
