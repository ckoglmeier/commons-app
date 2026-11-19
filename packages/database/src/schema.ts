import type { EvidenceRecord, InventoryCheckSelection, InventoryObservation, InventoryRequest, PollAnswer, PollQuestion, PollWorkingData, ProposalPayload, SubmitFeedbackRequest } from "@commons/contracts";
import type { VerificationAttemptResult } from "@commons/domain";
import {
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

const createdAt = timestamp("created_at", { withTimezone: true })
  .notNull()
  .defaultNow();
const updatedAt = timestamp("updated_at", { withTimezone: true })
  .notNull()
  .defaultNow();

/** Operator-authored immutable recipe revisions. Execution state stays in trip drafts/goals. */
export const workflowTemplates = pgTable("workflow_templates", {
  id: uuid("id").primaryKey().defaultRandom(),
  key: text("key").notNull(), version: integer("version").notNull(),
  title: text("title").notNull(), description: text("description").notNull(),
  purpose: text("purpose").$type<import("@commons/contracts").WorkflowPurpose>().notNull(),
  instructions: text("instructions").notNull(),
  status: text("status").$type<"draft" | "active" | "retired">().notNull().default("draft"),
  authoredBy: text("authored_by").notNull(),
  saveCommandId: uuid("save_command_id").notNull(), saveFingerprint: text("save_fingerprint").notNull(),
  activationCommandId: uuid("activation_command_id"), activationFingerprint: text("activation_fingerprint"),
  createdAt,
}, t => [
  uniqueIndex("workflow_templates_key_version").on(t.key, t.version),
  uniqueIndex("workflow_templates_active_key").on(t.key).where(sql`${t.status} = 'active'`),
  uniqueIndex("workflow_templates_save_command").on(t.saveCommandId),
  uniqueIndex("workflow_templates_activation_command").on(t.activationCommandId),
  check("workflow_templates_bounds", sql`${t.version} > 0 and ${t.key} ~ '^[a-z][a-z0-9_]{2,63}$' and length(${t.title}) between 1 and 120 and length(${t.description}) between 1 and 500 and length(${t.instructions}) between 20 and 12000`),
  check("workflow_templates_status", sql`${t.status} in ('draft','active','retired')`),
  check("workflow_templates_purpose", sql`${t.purpose} in ('trip_feasibility','attendance_confirmation','lodging_selection','general_poll','itinerary')`),
]).enableRLS();

export type OperatorNotificationPayload =
  | { kind: "feedback"; feedbackId: string; submission: SubmitFeedbackRequest }
  | { kind: "beta_access"; email: string; personId: string }
  | { kind: "traffic_alert"; hour: string; signal: string; label: string; count: number; level: number }
  | {
    kind: "daily_analytics";
    report: {
      periodKey: string;
      startsAt: string;
      endsAt: string;
      activePeople: number;
      sessions: number;
      pageViews: number;
      tripsCreated: number;
      peopleCreated: number;
      invitationsSent: number;
      invitationsAccepted: number;
      messages: number;
      pollsCreated: number;
      pollResponses: number;
      plansAdded: number;
      staysAdded: number;
      expensesAdded: number;
      photosAdded: number;
      feedbackSubmitted: number;
      betaAccessRequested: number;
      topEvents: Array<{ name: string; count: number }>;
      /** Free beta funnel and server outcome counts (daily-analytics-repository.ts); absent on older reports. */
      funnel?: Record<string, number | Record<string, number>>;
    };
  };

// Private support submissions only. Never a general-purpose trip-content outbox.
export const operatorNotificationDeliveries = pgTable("operator_notification_deliveries", {
  id: uuid("id").defaultRandom().primaryKey(),
  dedupeKey: text("dedupe_key").notNull(),
  payload: jsonb("payload").$type<OperatorNotificationPayload>().notNull(),
  status: text("status").$type<"queued" | "processing" | "sent" | "failed">().notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  firstAttemptAt: timestamp("first_attempt_at", { withTimezone: true }),
  providerMessageId: text("provider_message_id"),
  errorCode: text("error_code"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  createdAt,
}, table => [
  uniqueIndex("operator_notifications_dedupe_idx").on(table.dedupeKey),
  index("operator_notifications_ready_idx").on(table.status, table.availableAt),
  check("operator_notifications_status_check", sql`${table.status} in ('queued', 'processing', 'sent', 'failed')`),
]);

export const identityKind = pgEnum("identity_kind", [
  "phone",
  "email",
  "imessage_handle",
  "whatsapp_handle",
]);
export const identityState = pgEnum("identity_state", [
  "observed",
  "channel_verified",
  "claimed",
]);
export const commonsStatus = pgEnum("commons_status", [
  "planning",
  "active",
  "closing",
  "archived",
]);
export const membershipRole = pgEnum("membership_role", [
  "organizer",
  "member",
]);
export const membershipStatus = pgEnum("membership_status", [
  "invited",
  "active",
  "left",
  "removed",
]);
export const invitationStatus = pgEnum("invitation_status", [
  "pending",
  "accepted",
  "revoked",
  "expired",
]);
export const actorType = pgEnum("actor_type", ["human", "commons", "agent"]);
export const messageSource = pgEnum("message_source", ["channel", "web"]);
export const proposalStatus = pgEnum("proposal_status", [
  "proposed",
  "approved",
  "rejected",
  "expired",
  "superseded",
]);
export const proposalScope = pgEnum("proposal_scope", [
  "everyone",
  "subgroup",
  "individual",
]);
export const itineraryStatus = pgEnum("itinerary_status", [
  "idea",
  "planned",
  "confirmed",
  "cancelled",
]);
export const participationStatus = pgEnum("participation_status", [
  "in",
  "maybe",
  "skip",
]);
export const expenseStatus = pgEnum("expense_status", [
  "draft",
  "confirmed",
  "disputed",
]);
export const expenseSplitMethod = pgEnum("expense_split_method", [
  "equal",
  "exact",
  "shares",
  "percentage",
]);
export const receiptStatus = pgEnum("receipt_status", [
  "not_attached",
  "attached",
  "not_expected",
]);
export const ledgerSource = pgEnum("ledger_source", [
  "thread",
  "web",
  "import",
]);
export const momentSource = pgEnum("moment_source", [
  "thread",
  "web",
  "import",
]);
export const eventCreationDraftStatus = pgEnum("event_creation_draft_status", [
  "reviewing",
  "committed",
  "abandoned",
]);
export const pollBallotMode = pgEnum("poll_ballot_mode", ["transparent", "secret"]);
export const pollStatus = pgEnum("poll_status", ["open", "closed", "revoked"]);
export const stayStatus = pgEnum("stay_status", ["considering", "planned", "confirmed"]);

// Server-mediated personal delivery preferences. No direct client policies.
export const eventDigestPreferences = pgTable("event_digest_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  personId: uuid("person_id").notNull().references((): AnyPgColumn => people.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references((): AnyPgColumn => commons.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(true),
  resumeAfter: timestamp("resume_after", { withTimezone: true }),
  updatedAt,
}, table => [uniqueIndex("event_digest_preferences_person_event_unique").on(table.personId, table.commonsId)]).enableRLS();

export const people = pgTable(
  "people",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: uuid("auth_user_id"),
    /** Beta benefit. Persist when paid access opens; never inferred from payment-provider settings. */
    doNotCharge: boolean("do_not_charge").notNull().default(true),
    displayName: text("display_name").notNull(),
    avatarUrl: text("avatar_url"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("people_auth_user_id_unique").on(table.authUserId)],
);

export const eventCreationAccess = pgTable(
  "event_creation_access",
  {
    personId: uuid("person_id")
      .primaryKey()
      .references(() => people.id, { onDelete: "cascade" }),
    requesterEmail: text("requester_email").notNull(),
    status: text("status").notNull().default("requested"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedByPersonId: uuid("decided_by_person_id").references(() => people.id, { onDelete: "set null" }),
    decisionNote: text("decision_note"),
    /** Existing grants keep pilot capabilities. A beta invite approval never grants Coordinator, research or voice. */
    grantsPilotCapabilities: boolean("grants_pilot_capabilities").notNull().default(true),
    /** The saved private draft to return to after approval. Never brief text. */
    resumeDraftId: uuid("resume_draft_id").references(() => eventCreationDrafts.id, { onDelete: "set null" }),
    /** Delivery of the approval notice is separate from the decision: none, prepared, sending, sent or retry_pending. */
    approvalNoticeStatus: text("approval_notice_status").notNull().default("none"),
    approvalNoticeLeaseAt: timestamp("approval_notice_lease_at", { withTimezone: true }),
    approvalNoticeSentAt: timestamp("approval_notice_sent_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [index("event_creation_access_status_requested_idx").on(table.status, table.requestedAt)],
);

export const betaOrganizerInvites = pgTable("beta_organizer_invites", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  message: text("message").notNull().default(""),
  invitedByPersonId: uuid("invited_by_person_id").notNull().references(() => people.id),
  claimedByPersonId: uuid("claimed_by_person_id").references(() => people.id),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt,
}).enableRLS();

export const operatorAuditEvents = pgTable(
  "operator_audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorPersonId: uuid("actor_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    reason: text("reason"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("operator_audit_events_occurred_idx").on(table.occurredAt)],
);

export const identities = pgTable(
  "identities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    kind: identityKind("kind").notNull(),
    displayValueEncrypted: text("display_value_encrypted"),
    normalizedHash: text("normalized_hash").notNull(),
    state: identityState("state").notNull().default("observed"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("identities_kind_hash_unique").on(
      table.kind,
      table.normalizedHash,
    ),
    index("identities_person_idx").on(table.personId),
  ],
);

export const travelerProfiles = pgTable("traveler_profiles", {
  personId: uuid("person_id")
    .primaryKey()
    .references(() => people.id, { onDelete: "cascade" }),
  usualOriginLabel: text("usual_origin_label"),
  usualOriginSuppliedByPersonId: uuid("usual_origin_supplied_by_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  dietaryPreferences: text("dietary_preferences"),
  dietaryPreferencesSuppliedByPersonId: uuid("dietary_preferences_supplied_by_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  accessibilityNeeds: text("accessibility_needs"),
  accessibilityNeedsSuppliedByPersonId: uuid("accessibility_needs_supplied_by_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  lodgingPreferences: text("lodging_preferences"),
  lodgingPreferencesSuppliedByPersonId: uuid("lodging_preferences_supplied_by_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  transportationPreferences: text("transportation_preferences"),
  transportationPreferencesSuppliedByPersonId: uuid("transportation_preferences_supplied_by_person_id")
    .references(() => people.id, { onDelete: "set null" }),
  dailyDigestEnabled: boolean("daily_digest_enabled").notNull().default(true),
  profileVersion: integer("profile_version").notNull().default(1),
  createdAt,
  updatedAt,
});

export const commons = pgTable(
  "commons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    locationName: text("location_name"),
    locationNames: jsonb("location_names").$type<string[]>().notNull().default([]),
    balancesDisabled: boolean("balances_disabled").notNull().default(false),
    coverImageUrl: text("cover_image_url"),
    coverCardImageUrl: text("cover_card_image_url"),
    coverOriginalStoragePath: text("cover_original_storage_path"),
    coverCardStoragePath: text("cover_card_storage_path"),
    coverMimeType: text("cover_mime_type"),
    coverSourceMomentId: uuid("cover_source_moment_id"),
    /** Trip letter: organizer-written welcome, and how the letter's trusted sections are arranged. Presentation only. */
    welcomeMessage: text("welcome_message"),
    welcomeAuthorPersonId: uuid("welcome_author_person_id").references(() => people.id, { onDelete: "set null" }),
    letterSections: jsonb("letter_sections").$type<{ id: string; hidden: boolean }[]>(),
    timezone: text("timezone").notNull(),
    status: commonsStatus("status").notNull().default("planning"),
    setupCompletedAt: timestamp("setup_completed_at", { withTimezone: true }),
    firstSharedAt: timestamp("first_shared_at", { withTimezone: true }),
    /**
     * Set only when a trip is committed from a draft created while activation was on; existing trips stay null and exempt.
     * RESTRICT: losing the draft must never silently remove the gate.
     */
    activationDraftId: uuid("activation_draft_id").references((): AnyPgColumn => eventCreationDrafts.id, { onDelete: "restrict" }),
    /** The two-stage experience. On for trips created from this release, off for existing trips until an organizer turns it on. */
    newExperience: boolean("new_experience").notNull().default(false),
    /** Set when the organizer says "We're going". A new-experience trip without it is still getting to a decision. Never inferred from votes. */
    goingAt: timestamp("going_at", { withTimezone: true }),
    /** The free stage's big questions: which link poll asks each one and when it was decided, plus the deadline and rough cost shown on polls. The cost is an estimate, never a Money record. */
    bigQuestions: jsonb("big_questions").$type<Partial<Record<"where" | "when" | "who", { pollId?: string; decidedAt?: string; note?: string }>> & { decideBy?: string; roughCost?: string }>(),
    expensesClosedAt: timestamp("expenses_closed_at", { withTimezone: true }),
    expensesClosedByPersonId: uuid("expenses_closed_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    currency: text("currency").notNull().default("USD"),
    targetBudgetCurrency: text("target_budget_currency").notNull().default("USD"),
    targetBudgetCents: integer("target_budget_cents"),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id),
    eventTypeKey: text("event_type_key").notNull().default("travel"),
    eventContextKeys: jsonb("event_context_keys").$type<string[]>().notNull().default([]),
    templateKey: text("template_key"),
    templateVersion: integer("template_version"),
    creationSourceKind: text("creation_source_kind"),
    sourceEventId: uuid("source_event_id"),
    coordinatorSettings: jsonb("coordinator_settings").$type<{version:number;personality:{id:"commons"|"joan"|"becky"|"miles";specificationVersion:1}}>().notNull().default({version:0,personality:{id:"commons",specificationVersion:1}}),
    eventBrief: jsonb("event_brief").$type<Record<string, unknown>>(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("commons_slug_unique").on(table.slug)],
);

export const eventCreationDrafts = pgTable(
  "event_creation_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    status: eventCreationDraftStatus("status").notNull().default("reviewing"),
    version: integer("version").notNull().default(1),
    sourceKind: text("source_kind").notNull(),
    sourceEventId: uuid("source_event_id").references(() => commons.id, { onDelete: "set null" }),
    sourceEventName: text("source_event_name"),
    description: text("description"),
    proposedName: text("proposed_name"),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    locationName: text("location_name"),
    timezone: text("timezone").notNull(),
    eventTypeKey: text("event_type_key").notNull().default("travel"),
    eventContextKeys: jsonb("event_context_keys").$type<string[]>().notNull().default([]),
    templateKey: text("template_key").notNull().default("travel-general"),
    templateVersion: integer("template_version").notNull().default(1),
    supported: boolean("supported").notNull().default(true),
    brief: jsonb("brief").$type<Record<string, unknown>>().notNull().default({}),
    coordinator: jsonb("coordinator").$type<import("@commons/contracts").SetupCoordinatorState>().notNull().default({personality:{id:"commons",specificationVersion:1},startingPoint:null,turns:[]}),
    interpretationStatus: text("interpretation_status").notNull().default("not_required"),
    interpretationErrorCode: text("interpretation_error_code"),
    /** Server-set at creation while the activation flag is on. Clients can never change it. */
    betaActivationRequired: boolean("beta_activation_required").notNull().default(false),
    /** Public acquisition identifiers only (template, destination, source). Never private brief text. */
    entryContext: jsonb("entry_context").$type<{ template?: string; destination?: string; source?: string }>(),
    committedEventId: uuid("committed_event_id").references(() => commons.id, { onDelete: "set null" }),
    committedEventSlug: text("committed_event_slug"),
    sourceDeleteAfter: timestamp("source_delete_after", { withTimezone: true }),
    committedAt: timestamp("committed_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("event_creation_drafts_owner_updated_idx").on(table.createdByPersonId, table.updatedAt),
    uniqueIndex("event_creation_drafts_committed_event_unique").on(table.committedEventId),
  ],
);

export const eventCreationDraftPeople = pgTable(
  "event_creation_draft_people",
  {
    id: uuid("id").primaryKey(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => eventCreationDrafts.id, { onDelete: "cascade" }),
    personId: uuid("person_id").references(() => people.id, { onDelete: "set null" }),
    sourceMembershipId: uuid("source_membership_id"),
    displayName: text("display_name").notNull(),
    email: text("email"),
    message: text("message"),
    source: text("source").notNull(),
    included: boolean("included").notNull().default(true),
    needsContact: boolean("needs_contact").notNull().default(false),
    position: integer("position").notNull().default(0),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("event_creation_draft_people_draft_position_idx").on(table.draftId, table.position),
    index("event_creation_draft_people_person_idx").on(table.personId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    role: membershipRole("role").notNull().default("member"),
    status: membershipStatus("status").notNull().default("invited"),
    attendanceState: text("attendance_state").$type<"helping" | "attending" | "declined">().notNull().default("helping"),
    attendanceDates: text("attendance_dates"),
    joinedAt: timestamp("joined_at", { withTimezone: true }),
    expensesCompleteAt: timestamp("expenses_complete_at", { withTimezone: true }),
    accessMode: text("access_mode").notNull().default("account"),
    managedByPersonIds: jsonb("managed_by_person_ids").$type<string[]>(),
    sharedPreferenceKeys: jsonb("shared_preference_keys").$type<string[]>().notNull().default([]),
    canClaimAccess: boolean("can_claim_access").notNull().default(false),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("memberships_commons_person_unique").on(
      table.commonsId,
      table.personId,
    ),
    index("memberships_person_idx").on(table.personId),
    check("memberships_attendance_state_check", sql`${table.attendanceState} in ('helping', 'attending', 'declined')`),
  ],
);

/** A reusable traveler invitation, never an individual's claim or poll credential. */
export const groupInvitations = pgTable("group_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  tokenHash: text("token_hash").notNull(),
  protectedToken: text("protected_token"),
  version: integer("version").notNull().default(1),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("group_invitations_commons_unique").on(table.commonsId),
  uniqueIndex("group_invitations_token_hash_unique").on(table.tokenHash),
  check("group_invitations_positive_version", sql`${table.version} > 0`),
]).enableRLS();

export const invitations = pgTable(
  "invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    provisionalPersonId: uuid("provisional_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    recipientName: text("recipient_name").notNull(),
    recipientEmail: text("recipient_email"),
    message: text("message"),
    tokenHash: text("token_hash").notNull(),
    tokenValue: text("token_value"),
    tokenVersion: integer("token_version").notNull().default(1),
    status: invitationStatus("status").notNull().default("pending"),
    deliveryState: text("delivery_state").notNull().default("not_sent"),
    queuedAt: timestamp("queued_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true }),
    deliveryErrorCode: text("delivery_error_code"),
    // Invitation links remain valid until they are accepted or explicitly revoked.
    // Authentication credentials have their own short-lived verification TTL.
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    acceptedByPersonId: uuid("accepted_by_person_id").references(() => people.id, {
      onDelete: "restrict",
    }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("invitations_token_hash_unique").on(table.tokenHash),
    index("invitations_commons_status_idx").on(table.commonsId, table.status),
  ],
);

// Goal threads are organizer-only shared workspaces. Historical coordinator rows remain
// unthreaded so rollout cannot turn private organizer conversations into shared history.
export const coordinatorThreads = pgTable("coordinator_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  version: integer("version").notNull().default(1),
  lastCommandId: uuid("last_command_id").notNull(),
  lastCommandFingerprint: text("last_command_fingerprint").notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt,
  updatedAt,
}, table => [
  uniqueIndex("coordinator_threads_commons_command_unique").on(table.commonsId, table.lastCommandId),
  index("coordinator_threads_commons_updated_idx").on(table.commonsId, table.updatedAt),
  check("coordinator_threads_positive_version", sql`${table.version} > 0`),
  check("coordinator_threads_status_check", sql`${table.status} in ('active', 'archived')`),
]).enableRLS();

/** Uploader-private extracted sources. Raw files are discarded after parsing. */
export const coordinatorSources = pgTable("coordinator_sources", {
  id: uuid("id").primaryKey(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(),
  boundThreadId: uuid("bound_thread_id").references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  filename: text("filename").notNull(),
  digest: text("digest").notNull(),
  extractedText: text("extracted_text").notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt,
  removedAt: timestamp("removed_at", { withTimezone: true }),
}, table => [index("coordinator_sources_owner_trip_idx").on(table.ownerPersonId, table.commonsId),
  check("coordinator_sources_text_bound", sql`length(${table.extractedText}) between 1 and 30000`),
  check("coordinator_sources_digest_bound", sql`length(${table.digest}) = 64`),
]).enableRLS();

export const polls = pgTable(
  "polls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    publicId: varchar("public_id", { length: 12 })
      .notNull()
      .default(sql`lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12))`),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id").references(() => coordinatorThreads.id, { onDelete: "set null" }),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    commandId: uuid("command_id").notNull(),
    title: text("title").notNull(),
    intro: text("intro"),
    ballotMode: pollBallotMode("ballot_mode").notNull(),
    status: pollStatus("status").notNull().default("open"),
    questions: jsonb("questions").$type<PollQuestion[]>().notNull(),
    audience: jsonb("audience").$type<import("@commons/contracts").PollAudience>(),
    sourcePollId: uuid("source_poll_id").references((): AnyPgColumn => polls.id, { onDelete: "set null" }),
    shareTokenHash: text("share_token_hash").notNull(),
    shareTokenValue: text("share_token_value").notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("polls_commons_command_unique").on(table.commonsId, table.commandId),
    uniqueIndex("polls_public_id_unique").on(table.publicId),
    uniqueIndex("polls_share_token_hash_unique").on(table.shareTokenHash),
    index("polls_commons_created_idx").on(table.commonsId, table.createdAt),
    check("polls_public_id_format_check", sql`${table.publicId} ~ '^[0-9a-f]{12}$'`),
  ],
);

export const pollResponses = pgTable(
  "poll_responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    pollId: uuid("poll_id")
      .notNull()
      .references(() => polls.id, { onDelete: "cascade" }),
    respondentPersonId: uuid("respondent_person_id").references(() => people.id, { onDelete: "set null" }),
    respondentAuthUserId: uuid("respondent_auth_user_id"),
    respondentName: text("respondent_name").notNull(),
    receiptTokenHash: text("receipt_token_hash").notNull(),
    answers: jsonb("answers").$type<PollAnswer[]>().notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt,
  },
  (table) => [
    uniqueIndex("poll_responses_receipt_token_unique").on(table.receiptTokenHash),
    index("poll_responses_poll_updated_idx").on(table.pollId, table.updatedAt),
    uniqueIndex("poll_responses_poll_auth_unique").on(table.pollId, table.respondentAuthUserId),
  ],
);

export const pollDrafts = pgTable("poll_drafts", {
  id: uuid("id").primaryKey(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => coordinatorThreads.id, { onDelete: "set null" }),
  ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  organizerShared: boolean("organizer_shared").notNull().default(false),
  version: integer("version").notNull().default(1),
  data: jsonb("data").$type<PollWorkingData>().notNull(),
  lastCommandId: uuid("last_command_id").notNull(),
  lastCommandFingerprint: text("last_command_fingerprint").notNull(),
  publishedPollId: uuid("published_poll_id").references(() => polls.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** Set only by a recipe run's own commands; the run owns the lifecycle, the draft stays the artifact. */
  runId: uuid("run_id").references((): AnyPgColumn => recipeRuns.id, { onDelete: "set null" }),
  createdAt,
  updatedAt,
}, table => [
  index("poll_drafts_run_idx").on(table.runId),
  index("poll_drafts_owner_event_idx").on(table.ownerPersonId, table.commonsId, table.updatedAt),
  check("poll_drafts_positive_version", sql`${table.version} > 0`),
]);

// Shared organizer turns are trip-scoped; legacy private turns retain their owner scope. These rows
// never participate in the shared messages feed, emails or participant exports.
export const coordinatorTurns = pgTable("coordinator_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  organizerShared: boolean("organizer_shared").notNull().default(false),
  sequence: integer("sequence").notNull(),
  commandId: uuid("command_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  userText: text("user_text").notNull(),
  assistantText: text("assistant_text").notNull(),
  workspace: jsonb("workspace").$type<import("@commons/contracts").CoordinatorWorkspace>(),
  draftId: uuid("draft_id").references(() => pollDrafts.id, { onDelete: "set null" }),
  contextPollId: uuid("context_poll_id").references(() => polls.id, { onDelete: "set null" }),
  contextTurnId: uuid("context_turn_id"),
  createdAt,
}, table => [
  uniqueIndex("coordinator_turns_owner_sequence_unique").on(table.commonsId, table.ownerPersonId, table.sequence).where(sql`not ${table.organizerShared} and ${table.threadId} is null`),
  uniqueIndex("coordinator_turns_shared_sequence_unique").on(table.commonsId, table.sequence).where(sql`${table.organizerShared} and ${table.threadId} is null`),
  uniqueIndex("coordinator_turns_thread_sequence_unique").on(table.threadId, table.sequence).where(sql`${table.threadId} is not null`),
  uniqueIndex("coordinator_turns_owner_command_unique").on(table.commonsId, table.ownerPersonId, table.commandId),
  check("coordinator_turns_positive_sequence", sql`${table.sequence} > 0`),
]).enableRLS();

/**
 * Conversation durability A2: one row per accepted turn attempt that runs outside the request that submitted it. The turn row stays the owner of
 * identity, lifecycle and the saved answer; this row only holds what an executor needs to claim, run and recover the attempt. `input` is the validated
 * command plus server-derived admission facts, never a cookie, token or browser request, and it is cleared when the attempt ends. A claim token fences
 * every write by the executor that holds it; `provider_started_at` marks the point after which a lost attempt is interrupted rather than reclaimed.
 */
export const coordinatorTurnExecutions = pgTable("coordinator_turn_executions", {
  turnId: uuid("turn_id").notNull().references(() => coordinatorTurns.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  commandId: uuid("command_id").notNull(),
  status: text("status").$type<"queued" | "running" | "completed" | "interrupted" | "cancelled">().notNull(),
  input: jsonb("input").$type<Record<string, unknown>>(),
  claimToken: uuid("claim_token"),
  claimedBy: text("claimed_by"),
  claims: integer("claims").notNull().default(0),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  providerStartedAt: timestamp("provider_started_at", { withTimezone: true }),
  progress: jsonb("progress").$type<{ phase: string | null; text: string | null; seq: number }>(),
  disposition: text("disposition"),
  createdAt,
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [
  primaryKey({ columns: [table.turnId, table.attempt] }),
  index("coordinator_turn_executions_open_idx").on(table.status, table.createdAt).where(sql`${table.status} in ('queued', 'running')`),
  index("coordinator_turn_executions_commons_idx").on(table.commonsId),
  check("coordinator_turn_executions_status", sql`${table.status} in ('queued','running','completed','interrupted','cancelled')`),
  check("coordinator_turn_executions_attempt", sql`${table.attempt} between 1 and 3`),
  check("coordinator_turn_executions_claims", sql`${table.claims} between 0 and 10`),
  check("coordinator_turn_executions_running_claim", sql`${table.status} <> 'running' or (${table.claimToken} is not null and ${table.leaseExpiresAt} is not null)`),
  check("coordinator_turn_executions_terminal_input", sql`${table.status} in ('queued','running') or ${table.input} is null`),
]).enableRLS();

export const coordinatorResearchRuns = pgTable("coordinator_research_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  commandId: uuid("command_id").notNull(),
  query: text("query").notNull(),
  status: text("status").$type<"complete" | "partial" | "unavailable">().notNull(),
  sources: jsonb("sources").$type<import("@commons/contracts").ResearchSource[]>().notNull(),
  limitations: jsonb("limitations").$type<string[]>().notNull(),
  createdAt,
}, table => [
  uniqueIndex("coordinator_research_runs_thread_command_unique").on(table.threadId, table.commandId),
  index("coordinator_research_runs_thread_created_idx").on(table.threadId, table.createdAt),
]).enableRLS();

export const coordinatorRecommendations = pgTable("coordinator_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(), commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  sourcePollId: uuid("source_poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }), ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  commandId: uuid("command_id").notNull(), fingerprint: text("fingerprint").notNull(), version: integer("version").notNull().default(1), preparedBy: text("prepared_by").notNull(), evidenceFingerprint: text("evidence_fingerprint").notNull(), recommendation: text("recommendation").notNull(), freshness: text("freshness").notNull(), uncertainties: jsonb("uncertainties").$type<string[]>().notNull(), openQuestions: jsonb("open_questions").$type<string[]>().notNull(), nextAction: text("next_action").notNull(), createdAt, updatedAt,
}, table => [uniqueIndex("coordinator_recommendations_owner_poll_unique").on(table.commonsId, table.ownerPersonId, table.sourcePollId), uniqueIndex("coordinator_recommendations_command_unique").on(table.commonsId, table.commandId)]).enableRLS();

export const invitationDeliveryAttempts = pgTable(
  "invitation_delivery_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => invitations.id, { onDelete: "cascade" }),
    tokenVersion: integer("token_version").notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    providerMessageId: text("provider_message_id"),
    authenticationEntry: text("authentication_entry"),
    returnPollPublicId: text("return_poll_public_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("invitation_delivery_attempts_ready_idx").on(
      table.status,
      table.availableAt,
    ),
    index("invitation_delivery_attempts_invitation_idx").on(table.invitationId),
  ],
);

export type ConversationDigestPayload = {
  references?: { messageIds: string[]; expenseIds: string[] };
  recipientAuthUserId: string;
  recipientName: string;
  events: Array<{
    name: string;
    slug: string;
    startsOn?: string | null;
    endsOn?: string | null;
    locationName?: string | null;
    locationNames?: string[];
    activityCount?: number;
    messageCount: number;
    expenseCount?: number;
    activities?: Array<{
      summary: string;
      occurredAt: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
      priority?: number;
    }>;
    messages: Array<{
      actorName: string;
      body: string;
      occurredAt: string;
    }>;
    expenses?: Array<{
      resourceId?: string;
      title: string;
      amountCents: number;
      currency: string;
      paidByName: string;
      addedAt: string;
    }>;
  }>;
};

export type ConversationDigestItemPayload =
  | {
      kind: "activity";
      summary: string;
      occurredAt: string;
      action?: string;
      resourceType?: string;
      resourceId?: string;
    }
  | {
      kind: "message";
      actorName: string;
      body: string;
      occurredAt: string;
    }
  | {
      kind: "expense";
      resourceId?: string;
      title: string;
      amountCents: number;
      currency: string;
      paidByName: string;
      addedAt: string;
    };

export const conversationDigestDeliveries = pgTable(
  "conversation_digest_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    periodKey: text("period_key").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowEndedAt: timestamp("window_ended_at", { withTimezone: true }).notNull(),
    payload: jsonb("payload").$type<ConversationDigestPayload>().notNull(),
    status: text("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
    leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
    errorCode: text("error_code"),
    providerMessageId: text("provider_message_id"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("conversation_digest_recipient_period_unique").on(
      table.recipientPersonId,
      table.periodKey,
    ),
    index("conversation_digest_ready_idx").on(table.status, table.availableAt),
  ],
);

export const conversationDigestItems = pgTable(
  "conversation_digest_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    recipientPersonId: uuid("recipient_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    sourceType: text("source_type").notNull(),
    sourceId: uuid("source_id").notNull(),
    payload: jsonb("payload").$type<ConversationDigestItemPayload>().notNull(),
    deliveryId: uuid("delivery_id").references(() => conversationDigestDeliveries.id, {
      onDelete: "cascade",
    }),
    includedAt: timestamp("included_at", { withTimezone: true }),
    createdAt,
  },
  (table) => [
    uniqueIndex("conversation_digest_item_source_unique").on(
      table.recipientPersonId,
      table.sourceType,
      table.sourceId,
    ),
    index("conversation_digest_items_pending_idx").on(
      table.deliveryId,
      table.createdAt,
    ),
  ],
);

export const consentEvents = pgTable(
  "consent_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    scope: text("scope").notNull(),
    noticeVersion: text("notice_version").notNull(),
    action: text("action").notNull(),
    source: text("source").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("consent_events_commons_person_idx").on(table.commonsId, table.personId)],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    actorPersonId: uuid("actor_person_id").references(() => people.id),
    actorName: text("actor_name").notNull(),
    actorType: actorType("actor_type").notNull(),
    body: text("body").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    source: messageSource("source").notNull(),
    sourceEventId: text("source_event_id"),
    createdAt,
  },
  (table) => [
    uniqueIndex("messages_commons_sequence_unique").on(
      table.commonsId,
      table.sequence,
    ),
    uniqueIndex("messages_commons_source_event_unique").on(
      table.commonsId,
      table.sourceEventId,
    ),
    index("messages_commons_occurred_idx").on(table.commonsId, table.occurredAt),
  ],
);

export const proposals = pgTable(
  "proposals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: proposalStatus("status").notNull().default("proposed"),
    scope: proposalScope("scope").notNull(),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    payload: jsonb("payload").$type<ProposalPayload>().notNull(),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedByPersonId: uuid("approved_by_person_id").references(() => people.id),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("proposals_id_version_unique").on(table.id, table.version),
    index("proposals_commons_status_idx").on(table.commonsId, table.status),
  ],
);

export const proposalEvidence = pgTable(
  "proposal_evidence",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    proposalId: uuid("proposal_id")
      .notNull()
      .references(() => proposals.id, { onDelete: "cascade" }),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "restrict" }),
    excerpt: text("excerpt").notNull(),
    relevance: integer("relevance"),
    createdAt,
  },
  (table) => [
    uniqueIndex("proposal_evidence_proposal_message_unique").on(
      table.proposalId,
      table.messageId,
    ),
  ],
);

// A saved map position for a stay or activity. All four columns are set together.
const placePinColumns = () => ({
  pinLatitude: doublePrecision("pin_latitude"),
  pinLongitude: doublePrecision("pin_longitude"),
  pinPrecision: text("pin_precision").$type<"exact" | "approximate">(),
  pinSource: text("pin_source").$type<"map_link" | "page" | "placed">(),
});
const placePinChecks = (name: string, table: { pinLatitude: AnyPgColumn; pinLongitude: AnyPgColumn; pinPrecision: AnyPgColumn; pinSource: AnyPgColumn }) => [
  check(`${name}_pin_complete`, sql`(${table.pinLatitude} IS NULL AND ${table.pinLongitude} IS NULL AND ${table.pinPrecision} IS NULL AND ${table.pinSource} IS NULL)
    OR (${table.pinLatitude} BETWEEN -90 AND 90 AND ${table.pinLongitude} BETWEEN -180 AND 180
      AND ${table.pinPrecision} IN ('exact', 'approximate') AND ${table.pinSource} IN ('map_link', 'page', 'placed'))`),
];

export const itineraryItems = pgTable(
  "itinerary_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    sourceProposalId: uuid("source_proposal_id").references(() => proposals.id),
    arrangerPersonId: uuid("arranger_person_id").references(() => people.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    scheduledDate: date("scheduled_date"),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    durationMinutes: integer("duration_minutes"),
    timezone: text("timezone").notNull(),
    locationName: text("location_name"),
    audience: proposalScope("audience").notNull(),
    status: itineraryStatus("status").notNull().default("planned"),
    expectedCostCurrency: text("expected_cost_currency").notNull().default("USD"),
    expectedCostCents: integer("expected_cost_cents"),
    expectedCostBasis: text("expected_cost_basis").$type<"total" | "per_person">().notNull().default("total"),
    note: text("note"),
    provenanceLabel: text("provenance_label").notNull(),
    createdAt,
    updatedAt,
    sourceUrl: text("source_url"),
    mealType: text("meal_type").$type<"restaurant" | "home">(),
    ...placePinColumns(),
  },
  (table) => [index("itinerary_commons_starts_idx").on(table.commonsId, table.startsAt),
    check("itinerary_meal_type", sql`${table.mealType} IS NULL OR ${table.mealType} IN ('restaurant', 'home')`),
    ...placePinChecks("itinerary_items", table)],
);

// Private per-person reservation details never enter shared itinerary projections.
export const mealReservations = pgTable("meal_reservations", {
  id: uuid("id").defaultRandom().primaryKey(),
  itineraryItemId: uuid("itinerary_item_id").notNull().references(() => itineraryItems.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  confirmationNumber: varchar("confirmation_number", { length: 120 }).notNull(),
  note: varchar("note", { length: 1000 }).notNull(),
  updatedAt,
}, table => [uniqueIndex("meal_reservations_item_person_idx").on(table.itineraryItemId, table.personId)]).enableRLS();

// A link records organizer intent to consider an existing Plan idea in a goal thread;
// it never copies or mutates the itinerary item itself.
export const coordinatorThreadIdeas = pgTable("coordinator_thread_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  itineraryItemId: uuid("itinerary_item_id").notNull().references(() => itineraryItems.id, { onDelete: "cascade" }),
  linkedByPersonId: uuid("linked_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  commandId: uuid("command_id").notNull(),
  createdAt,
}, table => [
  uniqueIndex("coordinator_thread_ideas_thread_item_unique").on(table.threadId, table.itineraryItemId),
  uniqueIndex("coordinator_thread_ideas_thread_command_unique").on(table.threadId, table.commandId),
]).enableRLS();

export const participation = pgTable(
  "participation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    itineraryItemId: uuid("itinerary_item_id")
      .notNull()
      .references(() => itineraryItems.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    status: participationStatus("status").notNull(),
    revision: integer("revision").notNull().default(1),
    source: text("source").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("participation_item_person_unique").on(
      table.itineraryItemId,
      table.personId,
    ),
  ],
);

/** One test-mode $20 activation per flagged draft. The live-mode check requires a separately authorized migration to change. */
export const tripActivationPayments = pgTable(
  "trip_activation_payments",
  {
    draftId: uuid("draft_id").primaryKey().references(() => eventCreationDrafts.id, { onDelete: "restrict" }),
    organizerId: uuid("organizer_id").notNull().references(() => people.id, { onDelete: "restrict" }),
    attemptId: uuid("attempt_id").notNull().defaultRandom(),
    sessionId: text("session_id"),
    checkoutUrl: text("checkout_url"),
    /** pending = no verified money; processing = provider says complete, funds unconfirmed; paid = signed evidence. */
    status: text("status").notNull().default("pending"),
    failureCode: text("failure_code"),
    paidEventId: text("paid_event_id"),
    paymentIntentId: text("payment_intent_id"),
    amountCents: integer("amount_cents").notNull().default(2000),
    currency: text("currency").notNull().default("USD"),
    /** Null means unknown. Never fabricate zero tax. */
    taxAmountCents: integer("tax_amount_cents"),
    livemode: boolean("livemode").notNull().default(false),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    /** Set exactly once, so a later replay can't resurrect an expense the organizer deleted. */
    feeRecordedAt: timestamp("fee_recorded_at", { withTimezone: true }),
    feeExpenseId: uuid("fee_expense_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("trip_activation_session_unique").on(table.sessionId),
    uniqueIndex("trip_activation_paid_event_unique").on(table.paidEventId),
    uniqueIndex("trip_activation_intent_unique").on(table.paymentIntentId),
    check("trip_activation_amount", sql`${table.amountCents} = 2000 AND ${table.currency} = 'USD'`),
    check("trip_activation_status", sql`${table.status} IN ('pending', 'processing', 'paid')`),
    check("trip_activation_test_mode", sql`${table.livemode} = false`),
    check("trip_activation_tax_range", sql`${table.taxAmountCents} BETWEEN 0 AND ${table.amountCents}`),
  ],
).enableRLS();

/** Provider refund evidence. Never moves money and never rewrites allocations, reimbursements or closed ledgers. */
export const tripActivationRefunds = pgTable(
  "trip_activation_refunds",
  {
    refundId: text("refund_id").primaryKey(),
    draftId: uuid("draft_id").notNull().references(() => tripActivationPayments.draftId, { onDelete: "restrict" }),
    status: text("status").notNull(),
    amountCents: integer("amount_cents").notNull(),
    eventId: text("event_id").notNull(),
    providerEventAt: timestamp("provider_event_at", { withTimezone: true }).notNull(),
    /** Whether an invitation had already reached someone when this refund was first recorded. */
    afterActivation: boolean("after_activation").notNull().default(false),
    /** A person decided what happens next on a refund that holds inviting. Reviewed-only never sets this. */
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolvedByPersonId: uuid("resolved_by_person_id").references(() => people.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("trip_activation_refunds_draft_idx").on(table.draftId),
    check("trip_activation_refund_amount", sql`${table.amountCents} > 0 AND ${table.amountCents} <= 2000`),
    check("trip_activation_refund_status", sql`${table.status} IN ('pending', 'succeeded', 'failed', 'canceled')`),
  ],
).enableRLS();

export const expenses = pgTable(
  "expenses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    paidByPersonId: uuid("paid_by_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    createdByPersonId: uuid("created_by_person_id")
      .references(() => people.id, { onDelete: "restrict" }),
    occurredOn: date("occurred_on").notNull(),
    category: text("category").notNull(),
    itineraryItemId: uuid("itinerary_item_id")
      .references(() => itineraryItems.id, { onDelete: "set null" }),
    status: expenseStatus("status").notNull().default("draft"),
    splitMethod: expenseSplitMethod("split_method").notNull(),
    balanceMode: text("balance_mode").notNull().default("allocated"),
    confirmationCode: text("confirmation_code"),
    receiptStatus: receiptStatus("receipt_status").notNull().default("not_attached"),
    source: ledgerSource("source").notNull(),
    sourceLabel: text("source_label").notNull(),
    externalId: text("external_id"),
    note: text("note"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("expenses_commons_occurred_idx").on(table.commonsId, table.occurredOn),
    index("expenses_itinerary_item_idx").on(table.itineraryItemId),
    uniqueIndex("expenses_commons_external_unique").on(table.commonsId, table.externalId),
  ],
);

export const expenseShares = pgTable(
  "expense_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expenseId: uuid("expense_id")
      .notNull()
      .references(() => expenses.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("expense_shares_expense_person_unique").on(
      table.expenseId,
      table.personId,
    ),
    index("expense_shares_person_idx").on(table.personId),
  ],
);

export const reimbursements = pgTable(
  "reimbursements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    fromPersonId: uuid("from_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    toPersonId: uuid("to_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull().default("USD"),
    occurredOn: date("occurred_on").notNull(),
    source: ledgerSource("source").notNull(),
    sourceLabel: text("source_label").notNull(),
    externalId: text("external_id"),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("reimbursements_commons_occurred_idx").on(
      table.commonsId,
      table.occurredOn,
    ),
    uniqueIndex("reimbursements_commons_external_unique").on(
      table.commonsId,
      table.externalId,
    ),
  ],
);

export const travelPlans = pgTable(
  "travel_plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    companionPersonId: uuid("companion_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    kind: text("kind").notNull(),
    date: date("date").notNull(),
    route: text("route").notNull(),
    connections: jsonb("connections").$type<import("@commons/contracts").FlightConnection[]>().notNull().default([]),
    time: text("time"),
    driverPersonId: uuid("driver_person_id").references(() => people.id, { onDelete: "set null" }),
    provider: text("provider"),
    vehicle: text("vehicle"),
    returnDate: date("return_date"),
    returnTime: text("return_time"),
    status: text("status").notNull().default("confirmed"),
    note: text("note"),
    visibility: text("visibility").notNull().default("private"),
    confirmationCode: text("confirmation_code"),
    totalCents: integer("total_cents"),
    currency: text("currency").notNull().default("USD"),
    sourceLabel: text("source_label").notNull(),
    legacyExpenseId: uuid("legacy_expense_id").references(() => expenses.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("travel_plans_commons_person_kind_unique").on(
      table.commonsId,
      table.personId,
      table.kind,
    ).where(sql`${table.kind} in ('arrival', 'departure')`),
    index("travel_plans_commons_date_idx").on(table.commonsId, table.date),
    uniqueIndex("travel_plans_legacy_expense_unique").on(table.legacyExpenseId),
    check("travel_plans_visibility_check", sql`${table.visibility} in ('private', 'basic', 'all')`),
    check("travel_plans_total_positive", sql`${table.totalCents} is null or ${table.totalCents} > 0`),
    check("travel_plans_currency_check", sql`${table.currency} ~ '^[A-Z]{3}$'`),
    check("travel_plans_status_check", sql`${table.status} in ('considering', 'booked', 'confirmed')`),
  ],
);

export const travelPlanParticipants = pgTable(
  "travel_plan_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    travelPlanId: uuid("travel_plan_id")
      .notNull()
      .references(() => travelPlans.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "cascade" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("travel_plan_participants_plan_person_unique").on(table.travelPlanId, table.personId),
    index("travel_plan_participants_person_idx").on(table.personId),
  ],
);

export const stays = pgTable(
  "stays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    createdByPersonId: uuid("created_by_person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    address: text("address").notNull(),
    startsOn: date("starts_on").notNull(),
    endsOn: date("ends_on").notNull(),
    timezone: text("timezone"),
    checkInTime: text("check_in_time"),
    checkOutTime: text("check_out_time"),
    status: stayStatus("status").notNull().default("considering"),
    bookingUrl: text("booking_url"),
    pollId: uuid("poll_id").references(() => polls.id, { onDelete: "set null" }),
    confirmationCode: text("confirmation_code"),
    totalCents: integer("total_cents"),
    currency: text("currency").notNull().default("USD"),
    costSource: text("cost_source").$type<"estimate" | "confirmation" | "expense">(),
    includesTaxesAndFees: boolean("includes_taxes_and_fees"),
    details: text("details"),
    sourceLabel: text("source_label").notNull(),
    legacyExpenseId: uuid("legacy_expense_id").references(() => expenses.id, { onDelete: "set null" }),
    // Hotels quote per room. The group total stays in total_cents only once a room count makes it known.
    roomPriceCents: integer("room_price_cents"),
    roomCount: integer("room_count"),
    ...placePinColumns(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("stays_commons_dates_idx").on(table.commonsId, table.startsOn, table.endsOn),
    uniqueIndex("stays_legacy_expense_unique").on(table.legacyExpenseId),
    ...placePinChecks("stays", table),
    check("stays_room_price_positive", sql`${table.roomPriceCents} IS NULL OR ${table.roomPriceCents} > 0`),
    check("stays_room_count_range", sql`${table.roomCount} IS NULL OR ${table.roomCount} BETWEEN 1 AND 50`),
  ],
);

export const stayParticipants = pgTable(
  "stay_participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    stayId: uuid("stay_id")
      .notNull()
      .references(() => stays.id, { onDelete: "cascade" }),
    personId: uuid("person_id")
      .notNull()
      .references(() => people.id, { onDelete: "restrict" }),
    createdAt,
  },
  (table) => [
    uniqueIndex("stay_participants_stay_person_unique").on(table.stayId, table.personId),
    index("stay_participants_person_idx").on(table.personId),
  ],
);

export const confirmationDocuments = pgTable(
  "confirmation_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
    ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    storagePath: text("storage_path").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull().default("application/pdf"),
    stayId: uuid("stay_id").references(() => stays.id, { onDelete: "cascade" }),
    travelPlanId: uuid("travel_plan_id").references(() => travelPlans.id, { onDelete: "cascade" }),
    expenseId: uuid("expense_id").references(() => expenses.id, { onDelete: "set null" }),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("confirmation_documents_storage_unique").on(table.storagePath),
    uniqueIndex("confirmation_documents_stay_unique").on(table.stayId),
    uniqueIndex("confirmation_documents_travel_unique").on(table.travelPlanId),
    uniqueIndex("confirmation_documents_expense_unique").on(table.expenseId),
    index("confirmation_documents_commons_owner_idx").on(table.commonsId, table.ownerPersonId),
    check("confirmation_documents_supported_type", sql`${table.mimeType} in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'message/rfc822')`),
    check("confirmation_documents_source_check", sql`${table.stayId} is not null or ${table.travelPlanId} is not null or ${table.expenseId} is not null`),
  ],
);

export const moments = pgTable(
  "moments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    kind: text("kind").notNull().default("photo"),
    storagePath: text("storage_path").notNull(),
    mimeType: text("mime_type").notNull().default("image/jpeg"),
    caption: text("caption").notNull(),
    altText: text("alt_text").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    dateStatus: text("date_status").notNull().default("confirmed"),
    itineraryItemId: uuid("itinerary_item_id").references(() => itineraryItems.id, {
      onDelete: "set null",
    }),
    eventMatchSource: text("event_match_source"),
    eventMatchConfidence: integer("event_match_confidence"),
    eventMatchReason: text("event_match_reason"),
    addedByPersonId: uuid("added_by_person_id").references(() => people.id, {
      onDelete: "set null",
    }),
    source: momentSource("source").notNull(),
    sourceLabel: text("source_label").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [
    index("moments_commons_occurred_idx").on(table.commonsId, table.occurredAt),
    uniqueIndex("moments_commons_storage_unique").on(
      table.commonsId,
      table.storagePath,
    ),
  ],
);

export const feedbackSubmissions = pgTable(
  "feedback_submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsSlug: text("commons_slug").notNull(),
    source: text("source").notNull(),
    questionVersion: integer("question_version").notNull(),
    respondentName: text("respondent_name"),
    answers: jsonb("answers").$type<Record<string, string>>().notNull(),
    pagePath: text("page_path").notNull(),
    idempotencyKey: uuid("idempotency_key").notNull(),
    createdAt,
  },
  (table) => [
    uniqueIndex("feedback_submissions_idempotency_unique").on(
      table.idempotencyKey,
    ),
    index("feedback_submissions_created_idx").on(table.createdAt),
  ],
);

export const productAnalyticsEvents = pgTable(
  "product_analytics_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    eventName: text("event_name").notNull(),
    anonymousId: uuid("anonymous_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    authUserId: text("auth_user_id"),
    commonsSlug: text("commons_slug"),
    pagePath: text("page_path").notNull(),
    referrer: text("referrer"),
    properties: jsonb("properties").$type<Record<string, string | number | boolean | null>>().notNull(),
    userAgent: text("user_agent"),
    country: text("country"),
    region: text("region"),
    city: text("city"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt,
  },
  (table) => [
    index("product_analytics_events_name_created_idx").on(table.eventName, table.createdAt),
    index("product_analytics_events_session_idx").on(table.sessionId, table.createdAt),
    index("product_analytics_events_auth_user_idx").on(table.authUserId, table.createdAt),
    index("product_analytics_events_commons_idx").on(table.commonsSlug, table.createdAt),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    commandId: text("command_id").notNull(),
    actorId: text("actor_id").notNull(),
    actorType: actorType("actor_type").notNull(),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id").notNull(),
    summary: text("summary").notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("audit_events_commons_command_unique").on(
      table.commonsId,
      table.commandId,
    ),
    index("audit_events_commons_occurred_idx").on(
      table.commonsId,
      table.occurredAt,
    ),
  ],
);

export const processedCommands = pgTable(
  "processed_commands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    commonsId: uuid("commons_id")
      .notNull()
      .references(() => commons.id, { onDelete: "cascade" }),
    commandId: text("command_id").notNull(),
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("processed_commands_commons_command_unique").on(
      table.commonsId,
      table.commandId,
    ),
  ],
);

// Keep completed rows as tombstones: old upload URLs must not make a deleted
// object readable again. No FK cascade: event removal must not discard cleanup.
export const photoDeletions = pgTable("photo_deletions", {
  id: uuid("id").primaryKey().defaultRandom(),
  storagePath: text("storage_path").notNull(),
  status: text("status").notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  createdAt,
  updatedAt,
}, table => [
  uniqueIndex("photo_deletions_path_unique").on(table.storagePath),
  index("photo_deletions_available_idx").on(table.status, table.availableAt),
]);

export const pollDecisions = pgTable("poll_decisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  approvedByPersonId: uuid("approved_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  approvedByName: text("approved_by_name").notNull(),
  evidenceFingerprint: text("evidence_fingerprint").notNull(),
  evidence: jsonb("evidence").$type<Record<string, unknown>>().notNull(),
  approval: jsonb("approval").$type<import("zod").infer<typeof import("@commons/contracts").ApprovePollDecisionSchema>>().notNull(),
  summary: text("summary").notNull(),
  target: text("target").$type<"record" | "plan_idea">().notNull(),
  planId: uuid("plan_id").references(() => itineraryItems.id, { onDelete: "set null" }),
  createdAt,
}, table => [uniqueIndex("poll_decisions_poll_unique").on(table.pollId)]);

/**
 * A guided planning run. It only links the records that already hold the work:
 * drafts (poll_drafts.run_id) → published polls (draft.published_poll_id) →
 * approved decisions (poll_decisions) → typed outcomes (recipe_outcomes).
 * Stages are derived from those records, never stored here. The workflow pin
 * keeps an in-flight run on the recipe version it started with.
 */
export const recipeRuns = pgTable("recipe_runs", {
  id: uuid("id").primaryKey(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  recipe: text("recipe").$type<import("@commons/contracts").RecipeId>().notNull(),
  workflow: jsonb("workflow").$type<import("@commons/contracts").WorkflowReference>().notNull(),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  commandId: uuid("command_id").notNull(),
  status: text("status").$type<"active" | "archived">().notNull().default("active"),
  createdAt,
  updatedAt,
}, t => [
  uniqueIndex("recipe_runs_commons_command").on(t.commonsId, t.commandId),
  index("recipe_runs_commons_recipe_idx").on(t.commonsId, t.recipe, t.createdAt),
  check("recipe_runs_recipe", sql`${t.recipe} in ('dates_location','attendance','lodging','food_preferences','transport','itinerary','custom_poll')`),
  check("recipe_runs_status", sql`${t.status} in ('active','archived')`),
]).enableRLS();

/** A typed result of one approved poll round. The decision stays the approval record; this adds the structured value and whether it has been applied. */
export const recipeOutcomes = pgTable("recipe_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  runId: uuid("run_id").notNull().references(() => recipeRuns.id, { onDelete: "cascade" }),
  pollId: uuid("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  decisionId: uuid("decision_id").notNull().references(() => pollDecisions.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"dates_location" | "attendance" | "lodging" | "food_preferences">().notNull(),
  result: jsonb("result").$type<import("@commons/contracts").RecipeOutcome>().notNull(),
  /** Trip dates/location when approved; applying requires them to be unchanged. */
  base: jsonb("base").$type<import("@commons/contracts").TripDatesLocation>().notNull(),
  status: text("status").$type<"approved" | "applied" | "superseded">().notNull().default("approved"),
  approvedByPersonId: uuid("approved_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  approvedByName: text("approved_by_name").notNull(),
  appliedByPersonId: uuid("applied_by_person_id").references(() => people.id, { onDelete: "restrict" }),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
  appliedTargets: jsonb("applied_targets").$type<{ dates: boolean; location: boolean }>(),
  createdAt,
}, t => [
  uniqueIndex("recipe_outcomes_poll_unique").on(t.pollId),
  uniqueIndex("recipe_outcomes_decision_unique").on(t.decisionId),
  index("recipe_outcomes_run_idx").on(t.runId, t.createdAt),
  check("recipe_outcomes_kind", sql`${t.kind} in ('dates_location','attendance','lodging','food_preferences')`),
  check("recipe_outcomes_status", sql`${t.status} in ('approved','applied','superseded')`),
  check("recipe_outcomes_applied_consistent", sql`(${t.status} = 'applied') = (${t.appliedAt} is not null and ${t.appliedTargets} is not null and ${t.appliedByPersonId} is not null) or ${t.status} = 'superseded'`),
]).enableRLS();

export const pollDeliveries = pgTable("poll_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  pollId: uuid("poll_id").notNull().references(() => polls.id, { onDelete: "cascade" }),
  recipientEmail: text("recipient_email").notNull(),
  personId: uuid("person_id").references(() => people.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("queued"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  providerMessageId: text("provider_message_id"),
  createdAt,
  updatedAt,
}, table => [
  uniqueIndex("poll_deliveries_poll_email_unique").on(table.pollId, table.recipientEmail),
  index("poll_deliveries_ready_idx").on(table.status, table.availableAt),
  check("poll_deliveries_status_check", sql`${table.status} in ('queued', 'processing', 'sent', 'failed', 'cancelled')`),
]);

// Uncommitted discovery evidence: never materialized into a Stay, Plan, or expense here.
export const discoveryEvidence = pgTable("discovery_evidence", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  suppliedByPersonId: uuid("supplied_by_person_id").notNull().references(() => people.id),
  audience: text("audience").$type<"private" | "event">().notNull(),
  identityKey: text("identity_key").notNull(),
  record: jsonb("record").$type<EvidenceRecord>().notNull(),
  createdAt,
}, table => [
  uniqueIndex("discovery_evidence_identity_unique").on(table.commonsId, table.suppliedByPersonId, table.identityKey),
  uniqueIndex("discovery_evidence_event_id_unique").on(table.commonsId, table.id),
  check("discovery_evidence_audience_check", sql`${table.audience} in ('private', 'event')`),
]);

export const inventoryChecks = pgTable("inventory_checks", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  evidenceId: uuid("evidence_id").notNull(),
  requestedByPersonId: uuid("requested_by_person_id").notNull().references(() => people.id),
  providerId: text("provider_id").notNull(),
  cacheKey: text("cache_key").notNull(),
  selection: jsonb("selection").$type<InventoryCheckSelection>().notNull(),
  request: jsonb("request").$type<InventoryRequest>().notNull(),
  status: text("status").$type<"pending" | "processing" | "succeeded" | "failed">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  history: jsonb("history").$type<Array<{ attempt: number; result: VerificationAttemptResult | null; errorCode: string | null; finishedAt: string }>>().notNull().default([]),
  observation: jsonb("observation").$type<InventoryObservation>(),
  createdAt,
  updatedAt,
}, table => [
  foreignKey({ name: "inventory_checks_event_evidence_fk", columns: [table.commonsId, table.evidenceId], foreignColumns: [discoveryEvidence.commonsId, discoveryEvidence.id] }),
  index("inventory_checks_ready_idx").on(table.status, table.availableAt),
  index("inventory_checks_event_idx").on(table.commonsId, table.evidenceId),
  index("inventory_checks_cache_idx").on(table.commonsId, table.requestedByPersonId, table.cacheKey),
  check("inventory_checks_status_check", sql`${table.status} in ('pending', 'processing', 'succeeded', 'failed')`),
  check("inventory_checks_attempts_check", sql`${table.attempts} between 0 and 5`),
]);

export const researchTasks = pgTable("research_tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  requestedByPersonId: uuid("requested_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  commandId: uuid("command_id").notNull(), fingerprint: text("fingerprint").notNull(),
  request: jsonb("request").$type<import("@commons/contracts").ResearchDelegationRequest>().notNull(),
  status: text("status").$type<"pending" | "processing" | "succeeded" | "failed" | "cancelled" | "needs_input">().notNull().default("pending"),
  attempts: integer("attempts").notNull().default(0),
  availableAt: timestamp("available_at", { withTimezone: true }).notNull().defaultNow(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }),
  errorCode: text("error_code"),
  result: jsonb("result").$type<import("@commons/contracts").CoordinatorResearch>(),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("research_tasks_event_command_unique").on(table.commonsId, table.commandId),
  index("research_tasks_ready_idx").on(table.status, table.availableAt, table.leaseExpiresAt),
  check("research_tasks_status_check", sql`${table.status} in ('pending','processing','succeeded','failed','cancelled','needs_input')`),
  // `attempts` is the claim counter and the lease fence: it never resets, so a steered task's old claims can never match a newer one.
  // The retry budget (DELIVERY_MAX_ATTEMPTS) is counted per brief revision from `coordinator_task_state.attempts_base`.
  check("research_tasks_attempts_check", sql`${table.attempts} between 0 and 1000`),
]).enableRLS();

export const researchAttempts = pgTable("research_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskId: uuid("task_id").notNull().references(() => researchTasks.id, { onDelete: "cascade" }),
  attempt: integer("attempt").notNull(),
  agentId: text("agent_id").notNull(),
  status: text("status").$type<"processing" | "succeeded" | "failed" | "expired" | "cancelled" | "superseded">().notNull(),
  errorCode: text("error_code"), createdAt,
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, table => [
  uniqueIndex("research_attempts_task_number_unique").on(table.taskId, table.attempt),
  check("research_attempts_status_check", sql`${table.status} in ('processing','succeeded','failed','expired','cancelled','superseded')`),
]).enableRLS();

/*
 * Steering state for durable tasks (COMMONS_COORDINATOR_STEERING_ENABLED). A side table, not new columns on research_tasks/coordinator_threads, so every
 * query that exists today keeps working on a database where this migration has not been applied (Preview and Production share one database, and Preview
 * builds never migrate). A research task with no row here is revision 1 with no extra brief, exactly as before.
 */
export const coordinatorTaskState = pgTable("coordinator_task_state", {
  taskId: uuid("task_id").primaryKey().references(() => researchTasks.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  /** The current bounded brief (organizer-visible constraints). Never sent to a provider; only the task's public search query is. */
  brief: text("brief").notNull(),
  /** Increments atomically with every accepted correction. A claim records it; a commit must still match it. */
  revision: integer("revision").notNull().default(1),
  /** The brief revision `research_tasks.result` answers. Less than `revision` means that result is outdated and a newer one is being prepared. */
  resultRevision: integer("result_revision"),
  /** The specific missing fact when the task is waiting for the organizer (status needs_input). */
  needsInput: text("needs_input"),
  /** `research_tasks.attempts` when the current revision began, so the retry budget is per revision while the fence stays monotonic. */
  attemptsBase: integer("attempts_base").notNull().default(0),
  /** The thread's turn version when the brief was last set: what the task was prepared against. */
  contextVersion: integer("context_version"),
  createdAt, updatedAt,
}, table => [
  index("coordinator_task_state_commons_idx").on(table.commonsId),
  check("coordinator_task_state_revision_check", sql`${table.revision} > 0 and ${table.attemptsBase} >= 0`),
]).enableRLS();

/**
 * Append-only history of what organizers and workers did to a task: the steering command (with its idempotency key and the revision it expected),
 * correction provenance, and exactly one completion per task revision. Holds no provider output; `summary` is the organizer's own correction text.
 */
export const coordinatorTaskEvents = pgTable("coordinator_task_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => researchTasks.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
  kind: text("kind").$type<"started" | "amended" | "cancelled" | "completed" | "failed">().notNull(),
  revision: integer("revision").notNull(),
  /** The organizer's idempotency key for amend/cancel; null for system events. */
  commandId: uuid("command_id"),
  fingerprint: text("fingerprint"),
  expectedRevision: integer("expected_revision"),
  summary: text("summary"),
  /** The research run saved for a `completed` event, so a run can be shown as current or outdated. */
  runId: uuid("run_id"),
  createdAt,
}, table => [
  uniqueIndex("coordinator_task_events_command_unique").on(table.commonsId, table.commandId).where(sql`${table.commandId} is not null and ${table.kind} in ('amended', 'cancelled')`),
  uniqueIndex("coordinator_task_events_one_completion_per_revision").on(table.taskId, table.revision).where(sql`${table.kind} = 'completed'`),
  index("coordinator_task_events_task_idx").on(table.taskId, table.createdAt),
  check("coordinator_task_events_kind_check", sql`${table.kind} in ('started', 'amended', 'cancelled', 'completed', 'failed')`),
]).enableRLS();

/**
 * The relation of a thread to the conversation structure, kept beside `coordinator_threads` (also a side table, for the same reason as task state).
 * No row = a historical or ordinary topic thread. `main` = the one default trip conversation, enforced by a partial unique index; `sub` = a thread the
 * organizer chose to start from another, with its attributed starting brief.
 */
export const coordinatorThreadLinks = pgTable("coordinator_thread_links", {
  threadId: uuid("thread_id").primaryKey().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"main" | "sub" | "task">().notNull(),
  parentThreadId: uuid("parent_thread_id").references(() => coordinatorThreads.id, { onDelete: "set null" }),
  brief: text("brief"),
  briefTaskIds: jsonb("brief_task_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  createdAt,
}, table => [
  uniqueIndex("coordinator_thread_links_one_main_per_trip").on(table.commonsId).where(sql`${table.kind} = 'main'`),
  index("coordinator_thread_links_parent_idx").on(table.parentThreadId),
  check("coordinator_thread_links_kind_check", sql`${table.kind} in ('main', 'sub', 'task')`),
  check("coordinator_thread_links_main_has_no_parent", sql`${table.kind} <> 'main' or (${table.parentThreadId} is null and ${table.brief} is null)`),
]).enableRLS();

/** A concise outcome of a subthread's task shown once in the main conversation, deduplicated by task and result revision. Holds no source content beyond what the result itself shows. */
export const coordinatorThreadOutcomes = pgTable("coordinator_thread_outcomes", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  sourceThreadId: uuid("source_thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  targetThreadId: uuid("target_thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  taskId: uuid("task_id").notNull().references(() => researchTasks.id, { onDelete: "cascade" }),
  taskRevision: integer("task_revision").notNull(),
  summary: text("summary").notNull(),
  createdByPersonId: uuid("created_by_person_id").references(() => people.id, { onDelete: "set null" }),
  createdAt,
}, table => [
  uniqueIndex("coordinator_thread_outcomes_once").on(table.targetThreadId, table.taskId, table.taskRevision),
  index("coordinator_thread_outcomes_target_idx").on(table.targetThreadId, table.createdAt),
]).enableRLS();

/*
 * Task goals (docs/COORDINATOR-TASK-AGENTS-PLAN.md): the durable unit an organizer sees as a task. Side tables again, so a database where migration 0075 has not
 * been applied keeps working for every existing query. A goal owns one focused conversation (a coordinator thread linked with kind 'task'), a finish line,
 * and ordered typed steps that reuse research runs, polls, reviewed Plan proposals and participant outreach. It adds no queue and no agent loop.
 */
export const coordinatorGoals = pgTable("coordinator_goals", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  kind: text("kind").$type<import("@commons/contracts").GoalKind>().notNull(),
  mainThreadId: uuid("main_thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  /** The goal's own focused conversation. One goal per conversation. */
  threadId: uuid("thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  completionCriterion: text("completion_criterion").notNull(),
  /** Increments with every accepted change or reopen. Every step and report carries the revision it belongs to. */
  revision: integer("revision").notNull().default(1),
  contextVersion: integer("context_version"),
  lifecycle: text("lifecycle").$type<import("@commons/contracts").GoalLifecycle>().notNull().default("ready"),
  /** The question or approval being waited on. */
  waitDetail: text("wait_detail"),
  envelope: jsonb("envelope").$type<import("@commons/contracts").GoalEnvelope>().notNull(),
  /** Hash of the normalized goal, kind and linked ideas: at most one active goal per key, so a repeated start replays or offers the existing one. */
  goalKey: text("goal_key").notNull(),
  ideaIds: jsonb("idea_ids").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  /** The research task this goal was backfilled from; unique so re-running the backfill never duplicates a goal. */
  legacyTaskId: uuid("legacy_task_id").references(() => researchTasks.id, { onDelete: "set null" }),
  outcome: jsonb("outcome").$type<import("@commons/contracts").GoalOutcome>(),
  outcomeRevision: integer("outcome_revision"),
  errorCode: text("error_code"),
  commandId: uuid("command_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  createdAt, updatedAt,
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, table => [
  uniqueIndex("coordinator_goals_command_unique").on(table.commonsId, table.commandId),
  uniqueIndex("coordinator_goals_thread_unique").on(table.threadId),
  uniqueIndex("coordinator_goals_legacy_task_unique").on(table.legacyTaskId).where(sql`${table.legacyTaskId} is not null`),
  uniqueIndex("coordinator_goals_one_active_per_key").on(table.commonsId, table.goalKey).where(sql`${table.lifecycle} not in ('completed', 'failed', 'cancelled')`),
  index("coordinator_goals_trip_idx").on(table.commonsId, table.updatedAt),
  check("coordinator_goals_kind_check", sql`${table.kind} in ('research', 'poll', 'planning', 'plan_action', 'participant', 'book')`),
  check("coordinator_goals_lifecycle_check", sql`${table.lifecycle} in ('ready', 'running', 'waiting_for_input', 'waiting_for_approval', 'waiting_for_event', 'completed', 'failed', 'cancelled')`),
  check("coordinator_goals_revision_check", sql`${table.revision} > 0`),
]).enableRLS();

/** One typed unit of work for one goal revision. `refId` points at the existing record that does the work (research task, poll, turn holding a reviewed proposal, outreach). */
export const coordinatorGoalSteps = pgTable("coordinator_goal_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id").notNull().references(() => coordinatorGoals.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  goalRevision: integer("goal_revision").notNull(),
  seq: integer("seq").notNull(),
  kind: text("kind").$type<import("@commons/contracts").GoalStepKind>().notNull(),
  status: text("status").$type<import("@commons/contracts").GoalStepStatus>().notNull().default("pending"),
  params: jsonb("params").$type<import("@commons/contracts").GoalStepParams>().notNull(),
  refId: uuid("ref_id"),
  /** What the step produced, written by code from the stored result (a poll tally, a receipt, a statement). */
  result: jsonb("result").$type<Record<string, unknown>>(),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  createdAt,
}, table => [
  uniqueIndex("coordinator_goal_steps_position_unique").on(table.goalId, table.goalRevision, table.seq),
  index("coordinator_goal_steps_ref_idx").on(table.refId),
  index("coordinator_goal_steps_waiting_idx").on(table.kind, table.status),
  check("coordinator_goal_steps_kind_check", sql`${table.kind} in ('research', 'poll', 'planning', 'plan_action', 'outreach')`),
  check("coordinator_goal_steps_status_check", sql`${table.status} in ('pending', 'running', 'waiting', 'done', 'failed', 'cancelled', 'superseded')`),
]).enableRLS();

/** Append-only history, with the organizer's idempotency key for every command. Holds the organizer's own words and code-written summaries, never provider output. */
export const coordinatorGoalEvents = pgTable("coordinator_goal_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  goalId: uuid("goal_id").notNull().references(() => coordinatorGoals.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  goalRevision: integer("goal_revision").notNull(),
  actorPersonId: uuid("actor_person_id").references(() => people.id, { onDelete: "set null" }),
  commandId: uuid("command_id"),
  fingerprint: text("fingerprint"),
  /** A system event key (for example `poll:<id>:<responses>`), so a repeated delivery of the same event is one row. */
  eventKey: text("event_key"),
  summary: text("summary"),
  createdAt,
}, table => [
  uniqueIndex("coordinator_goal_events_command_unique").on(table.commonsId, table.commandId).where(sql`${table.commandId} is not null`),
  uniqueIndex("coordinator_goal_events_event_key_unique").on(table.goalId, table.eventKey).where(sql`${table.eventKey} is not null`),
  index("coordinator_goal_events_goal_idx").on(table.goalId, table.createdAt),
]).enableRLS();

/**
 * The report outbox, written in the same transaction as the state change it reports. `(goal, revision, kind, discriminator)` is unique, so a retry, a refresh
 * or a second worker can never produce a second report. The main conversation reads these rows; nothing is "posted" later by a separate process.
 */
export const coordinatorGoalReports = pgTable("coordinator_goal_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").notNull().references(() => coordinatorGoals.id, { onDelete: "cascade" }),
  mainThreadId: uuid("main_thread_id").notNull().references(() => coordinatorThreads.id, { onDelete: "cascade" }),
  goalRevision: integer("goal_revision").notNull(),
  kind: text("kind").$type<import("@commons/contracts").GoalReportKind>().notNull(),
  discriminator: text("discriminator").notNull().default(""),
  headline: text("headline").notNull(),
  detail: text("detail"),
  nextAction: text("next_action"),
  sources: jsonb("sources").$type<Array<{ title: string; url: string | null }>>().notNull().default(sql`'[]'::jsonb`),
  /** Set when a later revision replaced what this report said. The report stays as history. */
  supersededAt: timestamp("superseded_at", { withTimezone: true }),
  createdAt,
}, table => [
  uniqueIndex("coordinator_goal_reports_once").on(table.goalId, table.goalRevision, table.kind, table.discriminator),
  index("coordinator_goal_reports_main_idx").on(table.mainThreadId, table.createdAt),
  check("coordinator_goal_reports_kind_check", sql`${table.kind} in ('completed', 'needs_input', 'needs_approval', 'failed', 'milestone', 'late_reply')`),
]).enableRLS();

/**
 * Conversation durability lane B: one organizer-reviewed question to one traveler, answered on the authenticated web (channel 'web').
 *
 * Why not `coordinator_outreach`: outreach is one synthetic SMS step per goal step, correlated by conversation address, whose raw replies stay
 * private and advance the step sequence. This question attaches to a task (goal and its revision) without becoming its finish line, pins an exact
 * published wording, keeps answer revisions for deliberate corrections, and shares only the submitted answer with the task's organizers. Why not a
 * poll: polls address an audience, not one named recipient with recipient-only access, and have no expected-version correction. Old synthetic
 * outreach rows are untouched and never relabelled.
 */
export const participantQuestions = pgTable("participant_questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").notNull().references(() => coordinatorGoals.id, { onDelete: "cascade" }),
  /** The goal revision the question was published under; a new goal revision does not inherit an unanswered question. */
  goalRevision: integer("goal_revision").notNull(),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  recipientPersonId: uuid("recipient_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  channel: text("channel").$type<"web">().notNull().default("web"),
  status: text("status").$type<"draft" | "published" | "closed" | "cancelled">().notNull().default("draft"),
  /** Draft wording version; publication pins it. Changing recipient or wording after publication needs a new question. */
  version: integer("version").notNull().default(1),
  purpose: text("purpose").notNull(),
  question: text("question").notNull(),
  /** Who sees a submitted answer. One value in this release: the task's active organizers. */
  visibility: text("visibility").$type<"task_organizers">().notNull().default("task_organizers"),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createCommandId: uuid("create_command_id").notNull(),
  publishCommandId: uuid("publish_command_id"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  /** The current answer revision (0 = unanswered). */
  answerRevision: integer("answer_revision").notNull().default(0),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("participant_questions_create_unique").on(table.commonsId, table.createdByPersonId, table.createCommandId),
  index("participant_questions_recipient_idx").on(table.recipientPersonId, table.commonsId, table.status),
  index("participant_questions_goal_idx").on(table.goalId),
  check("participant_questions_status", sql`${table.status} in ('draft','published','closed','cancelled')`),
  check("participant_questions_channel", sql`${table.channel} = 'web'`),
  check("participant_questions_visibility", sql`${table.visibility} = 'task_organizers'`),
  check("participant_questions_bounds", sql`length(${table.question}) between 1 and 300 and length(${table.purpose}) between 1 and 160 and ${table.version} > 0 and ${table.answerRevision} >= 0`),
  check("participant_questions_published", sql`(${table.status} = 'draft') = (${table.publishedAt} is null)`),
  check("participant_questions_not_self", sql`${table.recipientPersonId} <> ${table.createdByPersonId}`),
]).enableRLS();

/** Every submitted answer revision. A correction adds a row; earlier rows stay as history. The submission id makes a retry replay its receipt. */
export const participantAnswers = pgTable("participant_answers", {
  id: uuid("id").primaryKey().defaultRandom(),
  questionId: uuid("question_id").notNull().references(() => participantQuestions.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  answeredByPersonId: uuid("answered_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  submissionId: uuid("submission_id").notNull(),
  fingerprint: text("fingerprint").notNull(),
  body: text("body").notNull(),
  createdAt,
}, table => [
  uniqueIndex("participant_answers_revision_unique").on(table.questionId, table.revision),
  uniqueIndex("participant_answers_submission_unique").on(table.questionId, table.submissionId),
  check("participant_answers_bounds", sql`${table.revision} > 0 and length(${table.body}) between 1 and 1000`),
]).enableRLS();

/** An organizer dismissed a Plan-idea suggestion; it stays quiet until the idea's fingerprint (title, status, note) materially changes. */
export const coordinatorGoalSuggestionDismissals = pgTable("coordinator_goal_suggestion_dismissals", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
  itineraryItemId: uuid("itinerary_item_id").notNull().references(() => itineraryItems.id, { onDelete: "cascade" }),
  ideaFingerprint: text("idea_fingerprint").notNull(),
  createdAt,
}, table => [uniqueIndex("coordinator_goal_dismissals_unique").on(table.personId, table.itineraryItemId)]).enableRLS();

/**
 * One bounded participant conversation owned by a goal step. The recipient and exact question are snapshotted when an organizer approves the send. This
 * release has a synthetic transport only; nothing here reaches a real phone.
 */
export const coordinatorOutreach = pgTable("coordinator_outreach", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  goalId: uuid("goal_id").notNull().references(() => coordinatorGoals.id, { onDelete: "cascade" }),
  stepId: uuid("step_id").notNull().references(() => coordinatorGoalSteps.id, { onDelete: "cascade" }),
  recipientPersonId: uuid("recipient_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  channel: text("channel").$type<"synthetic_sms">().notNull().default("synthetic_sms"),
  /** The conversation address replies must arrive on; unique, so a reply identifies exactly one outreach in exactly one trip. */
  conversationAddress: text("conversation_address").notNull(),
  status: text("status").$type<import("@commons/contracts").OutreachStatus>().notNull().default("awaiting_approval"),
  sendSnapshot: jsonb("send_snapshot").$type<{ recipientName: string; question: string; text: string }>().notNull(),
  approvedByPersonId: uuid("approved_by_person_id").references(() => people.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  maxFollowUps: integer("max_follow_ups").notNull().default(1),
  followUpsSent: integer("follow_ups_sent").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("coordinator_outreach_address_unique").on(table.conversationAddress),
  uniqueIndex("coordinator_outreach_step_unique").on(table.stepId),
  index("coordinator_outreach_goal_idx").on(table.goalId),
  check("coordinator_outreach_status_check", sql`${table.status} in ('awaiting_approval', 'sent', 'replied', 'closed', 'opted_out', 'timed_out', 'failed')`),
  check("coordinator_outreach_followups_check", sql`${table.followUpsSent} between 0 and ${table.maxFollowUps}`),
]).enableRLS();

export const coordinatorOutreachMessages = pgTable("coordinator_outreach_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  outreachId: uuid("outreach_id").notNull().references(() => coordinatorOutreach.id, { onDelete: "cascade" }),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  direction: text("direction").$type<"outbound" | "inbound">().notNull(),
  /** The provider's id for the message; unique per outreach, so a duplicate delivery is one row. */
  providerMessageId: text("provider_message_id").notNull(),
  body: text("body").notNull(),
  /** A reply that arrived after the goal stopped waiting. Retained once, surfaced by policy, and never restarts outreach. */
  late: boolean("late").notNull().default(false),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  createdAt,
}, table => [
  uniqueIndex("coordinator_outreach_messages_provider_unique").on(table.outreachId, table.providerMessageId),
  check("coordinator_outreach_messages_direction_check", sql`${table.direction} in ('outbound', 'inbound')`),
]).enableRLS();

export const coordinatorPreferences = pgTable("coordinator_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, {onDelete:"cascade"}),
  personId: uuid("person_id").notNull().references(() => people.id, {onDelete:"cascade"}),
  dismissed: boolean("dismissed").notNull().default(false),
}, table => [uniqueIndex("coordinator_preferences_person_trip_unique").on(table.commonsId,table.personId)]).enableRLS();

/** Advisory Trip Brain. Restricted side tables; opt-in and entitlement are independent of task execution. */
export const tripBrainSettings = pgTable("trip_brain_settings", {
  commonsId: uuid("commons_id").primaryKey().references(() => commons.id, { onDelete: "cascade" }),
  optedIn: boolean("opted_in").notNull().default(false), paused: boolean("paused").notNull().default(true),
  entitled: boolean("entitled").notNull().default(false), budgetCents: integer("budget_cents"), reservedCents: integer("reserved_cents").notNull().default(0), spentCents: integer("spent_cents").notNull().default(0),
  optedByPersonId: uuid("opted_by_person_id").references(() => people.id, { onDelete: "set null" }), lastReviewAt: timestamp("last_review_at", { withTimezone: true }), nextReviewAt: timestamp("next_review_at", { withTimezone: true }), updatedAt,
}, t => [check("trip_brain_budget_valid", sql`${t.reservedCents} >= 0 and ${t.spentCents} >= 0 and (${t.budgetCents} is null or ${t.budgetCents} >= 0)`)]).enableRLS();
export const tripBrainReviews = pgTable("trip_brain_reviews", {
  id: uuid("id").primaryKey().defaultRandom(), commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  requestedByPersonId: uuid("requested_by_person_id").notNull().references(() => people.id), snapshotHash: text("snapshot_hash").notNull(), snapshot: jsonb("snapshot").$type<import("@commons/contracts").BrainSnapshot>().notNull(), localDay: text("local_day").notNull(),
  status: text("status").$type<"running" | "completed" | "superseded" | "failed">().notNull().default("running"), reservedCents: integer("reserved_cents").notNull(), actualCents: integer("actual_cents"), modelPolicy: text("model_policy").notNull(), execution: jsonb("execution").$type<import("@commons/contracts").BrainExecution>(), leaseUntil: timestamp("lease_until", { withTimezone: true }).notNull(), errorCode: text("error_code"), createdAt, finishedAt: timestamp("finished_at", { withTimezone: true }),
}, t => [uniqueIndex("trip_brain_reviews_one_day").on(t.commonsId,t.localDay), index("trip_brain_reviews_status").on(t.status,t.leaseUntil)]).enableRLS();
export const tripBrainRecommendations = pgTable("trip_brain_recommendations", {
  id: uuid("id").primaryKey().defaultRandom(), commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }), reviewId: uuid("review_id").notNull().references(() => tripBrainReviews.id, { onDelete: "cascade" }), snapshotHash: text("snapshot_hash").notNull(), evidenceHash: text("evidence_hash").notNull(), findingKey: text("finding_key").notNull(), finding: jsonb("finding").$type<import("@commons/contracts").BrainFinding>().notNull(),
  disposition: text("disposition").$type<"new" | "accepted" | "dismissed" | "snoozed" | "superseded">().notNull().default("new"), snoozedUntil: timestamp("snoozed_until", { withTimezone: true }), goalId: uuid("goal_id").references(() => coordinatorGoals.id, { onDelete: "set null" }), createdAt, updatedAt,
}, t => [uniqueIndex("trip_brain_recommendations_evidence").on(t.commonsId,t.findingKey,t.evidenceHash)]).enableRLS();

/** Owner-private upload/review state, never an organizer task or shared report. */
export const confirmationIntakes = pgTable("confirmation_intakes", {
  id: uuid("id").primaryKey().defaultRandom(), commonsId: uuid("commons_id").notNull().references(() => commons.id,{onDelete:"cascade"}), ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id,{onDelete:"cascade"}), digest: text("digest").notNull(), kind: text("kind").$type<import("@commons/contracts").ConfirmationDraft["kind"]>().notNull(), storagePath: text("storage_path").notNull(), fileName:text("file_name").notNull(), mimeType:text("mime_type").notNull(),
  status:text("status").$type<"processing"|"awaiting_review"|"failed"|"saved"|"cancelled">().notNull().default("processing"), revision:integer("revision").notNull().default(1), draft:jsonb("draft").$type<import("@commons/contracts").ConfirmationDraft>(), errorCode:text("error_code"), leaseUntil:timestamp("lease_until",{withTimezone:true}).notNull(), createdAt, updatedAt,
},t=>[uniqueIndex("confirmation_intakes_owner_digest").on(t.commonsId,t.ownerPersonId,t.digest,t.kind),index("confirmation_intakes_owner_status").on(t.commonsId,t.ownerPersonId,t.status)]).enableRLS();
export const coordinatorWorkerHealth=pgTable("coordinator_worker_health",{kind:text("kind").primaryKey(),seenAt:timestamp("seen_at",{withTimezone:true}).notNull()}).enableRLS();

/** Personal Coordinator history is never part of organizer threads, task reports, or trip context. */
export const personalCoordinatorTurns = pgTable("personal_coordinator_turns", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, {onDelete:"cascade"}),
  personId: uuid("person_id").notNull().references(() => people.id, {onDelete:"cascade"}),
  commandId: uuid("command_id").notNull(),
  userText: text("user_text").notNull(),
  reply: text("reply"),
  status: text("status").$type<"pending"|"completed"|"failed">().notNull(),
  attempt: integer("attempt").notNull().default(1),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("personal_coordinator_command_unique").on(table.commonsId,table.personId,table.commandId),
  index("personal_coordinator_history_idx").on(table.commonsId,table.personId,table.createdAt),
  check("personal_coordinator_status_check",sql`${table.status} in ('pending','completed','failed')`),
  check("personal_coordinator_bounds_check",sql`length(${table.userText}) between 1 and 1800 and (${table.reply} is null or length(${table.reply}) between 1 and 4000) and ${table.attempt} between 1 and 3`),
]).enableRLS();

// Simple Coordinator to-dos; independent of research executions and booking status.
export const tripTasks = pgTable("trip_tasks", {
  id: uuid("id").primaryKey(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  createdByPersonId: uuid("created_by_person_id").notNull().references(() => people.id),
  ownerPersonId: uuid("owner_person_id").notNull().references(() => people.id),
  title: text("title").notNull(), dueOn: date("due_on"), completed: boolean("completed").notNull().default(false),
  version: integer("version").notNull().default(1),
  brainFindingKey: text("brain_finding_key"),
  itemKind: text("item_kind").$type<"plan" | "travel" | "stay">(), itemId: uuid("item_id"),
  createdAt, updatedAt,
}, table => [index("trip_tasks_commons_owner_idx").on(table.commonsId, table.ownerPersonId), uniqueIndex("trip_tasks_brain_finding_unique").on(table.commonsId, table.brainFindingKey).where(sql`${table.brainFindingKey} IS NOT NULL`), check("trip_tasks_item_pair", sql`(${table.itemKind} IS NULL) = (${table.itemId} IS NULL)`)]).enableRLS();

/*
 * Beta completion (docs/BETA-COMPLETION-STATUS.md). Every table below is additive, empty until COMMONS_BETA_REWORK_ENABLED is on, and read only by
 * server code behind that flag. Deleting a trip removes its rows. None of them holds booking details, messages, consent or private notes.
 */

/**
 * A traveler's "I paid" report. It is a claim awaiting the person who was paid (or an organizer): it never changes a balance. Recording a receipt
 * creates the ordinary reimbursement and links it here; only that reimbursement settles anything. Each currency stays its own boundary.
 */
export const paymentReports = pgTable("payment_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  reportedByPersonId: uuid("reported_by_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  toPersonId: uuid("to_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  currency: text("currency").notNull(),
  amountCents: integer("amount_cents").notNull(),
  note: text("note"),
  status: text("status").$type<"reported" | "recorded" | "dismissed">().notNull().default("reported"),
  reimbursementId: uuid("reimbursement_id").references(() => reimbursements.id, { onDelete: "set null" }),
  commandId: uuid("command_id").notNull(),
  resolvedByPersonId: uuid("resolved_by_person_id").references(() => people.id, { onDelete: "set null" }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt,
}, table => [
  uniqueIndex("payment_reports_command_unique").on(table.commonsId, table.reportedByPersonId, table.commandId),
  index("payment_reports_commons_status_idx").on(table.commonsId, table.status),
  check("payment_reports_status", sql`${table.status} in ('reported','recorded','dismissed')`),
  check("payment_reports_bounds", sql`${table.amountCents} > 0 and ${table.amountCents} <= 100000000 and length(${table.currency}) = 3 and (${table.note} is null or length(${table.note}) <= 200) and ${table.reportedByPersonId} <> ${table.toPersonId}`),
  check("payment_reports_resolution", sql`(${table.status} = 'reported') = (${table.resolvedAt} is null)`),
]).enableRLS();

/** The organizer-approved wrap-up of a finished trip. Memories are references to existing Trip photos the organizer chose; nothing is copied. */
export const tripRecaps = pgTable("trip_recaps", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  approvedMomentIds: jsonb("approved_moment_ids").$type<string[]>().notNull().default([]),
  status: text("status").$type<"draft" | "shared">().notNull().default("draft"),
  approvedByPersonId: uuid("approved_by_person_id").references(() => people.id, { onDelete: "set null" }),
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  version: integer("version").notNull().default(1),
  createdAt, updatedAt,
}, table => [
  uniqueIndex("trip_recaps_commons_unique").on(table.commonsId),
  check("trip_recaps_status", sql`${table.status} in ('draft','shared')`),
  check("trip_recaps_bounds", sql`length(${table.summary}) <= 1200 and ${table.version} > 0 and jsonb_typeof(${table.approvedMomentIds}) = 'array' and jsonb_array_length(${table.approvedMomentIds}) <= 24`),
  check("trip_recaps_shared", sql`(${table.status} = 'shared') = (${table.approvedAt} is not null)`),
]).enableRLS();

/**
 * A DMO or travel-assistant partner inquiry. Stored first, then routed: delivery state is the real state of the one configured route, never
 * assumed. The client hash is salted and only used for rate limiting; no inquiry reads or writes trip data.
 */
export const partnerInquiries = pgTable("partner_inquiries", {
  id: uuid("id").primaryKey().defaultRandom(),
  kind: text("kind").$type<"dmo" | "travel_assistant">().notNull(),
  organization: text("organization").notNull(),
  contactName: text("contact_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  website: text("website"),
  region: text("region"),
  message: text("message").notNull(),
  sourcePath: text("source_path").notNull().default("/"),
  idempotencyKey: uuid("idempotency_key").notNull(),
  fingerprint: text("fingerprint").notNull(),
  clientHash: text("client_hash").notNull(),
  deliveryStatus: text("delivery_status").$type<"queued" | "sending" | "sent" | "failed" | "not_routed">().notNull().default("queued"),
  deliveryAttempts: integer("delivery_attempts").notNull().default(0),
  deliveryErrorCode: text("delivery_error_code"),
  deliveryLastAttemptAt: timestamp("delivery_last_attempt_at", { withTimezone: true }),
  routedTo: text("routed_to"),
  providerMessageId: text("provider_message_id"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt,
}, table => [
  uniqueIndex("partner_inquiries_idempotency_unique").on(table.idempotencyKey),
  index("partner_inquiries_created_idx").on(table.createdAt),
  index("partner_inquiries_rate_idx").on(table.clientHash, table.createdAt),
  index("partner_inquiries_fingerprint_idx").on(table.fingerprint, table.createdAt),
  check("partner_inquiries_kind", sql`${table.kind} in ('dmo','travel_assistant')`),
  check("partner_inquiries_delivery", sql`${table.deliveryStatus} in ('queued','sending','sent','failed','not_routed')`),
  check("partner_inquiries_bounds", sql`length(${table.organization}) between 1 and 160 and length(${table.contactName}) between 1 and 120 and length(${table.contactEmail}) between 3 and 254 and length(${table.message}) between 10 and 2000 and ${table.deliveryAttempts} >= 0`),
]).enableRLS();

/**
 * Privacy-safe attribution: which funnel step happened and which kind of entry it came from. No person, contact, name, text, address or
 * query string is stored. One row per subject and step, so a replay cannot inflate a count. The subject key is a trip id, or a random
 * per-draft key for steps that precede a trip.
 */
export const attributionEvents = pgTable("attribution_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  event: text("event").$type<"draft_started" | "approved" | "paid_activation" | "traveler_participation" | "traveler_to_organizer">().notNull(),
  entryKind: text("entry_kind").$type<"direct" | "template" | "destination" | "assistant" | "partner" | "recap" | "unknown">().notNull().default("unknown"),
  entryRef: text("entry_ref"),
  subjectKey: text("subject_key").notNull(),
  createdAt,
}, table => [
  uniqueIndex("attribution_events_subject_unique").on(table.event, table.subjectKey),
  index("attribution_events_created_idx").on(table.createdAt),
  check("attribution_events_event", sql`${table.event} in ('draft_started','approved','paid_activation','traveler_participation','traveler_to_organizer')`),
  check("attribution_events_entry", sql`${table.entryKind} in ('direct','template','destination','assistant','partner','recap','unknown')`),
  check("attribution_events_ref", sql`${table.entryRef} is null or ${table.entryRef} ~ '^[a-z0-9][a-z0-9-]{0,59}$'`),
  check("attribution_events_subject", sql`length(${table.subjectKey}) between 8 and 80`),
]).enableRLS();

/** Per-trip usage that costs money or has a limit: SMS segments, extraction and model calls, map lookups and payment fees. Counts only. */
export const tripUsageEvents = pgTable("trip_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"sms_segment" | "extraction_call" | "model_call" | "map_lookup" | "payment_fee">().notNull(),
  units: integer("units").notNull(),
  /** Estimated or actual cost in millionths of a dollar when known. An estimate is not a billing record. */
  costMicros: integer("cost_micros"),
  dedupeKey: text("dedupe_key"),
  createdAt,
}, table => [
  uniqueIndex("trip_usage_dedupe_unique").on(table.commonsId, table.kind, table.dedupeKey).where(sql`${table.dedupeKey} is not null`),
  index("trip_usage_trip_kind_idx").on(table.commonsId, table.kind, table.createdAt),
  check("trip_usage_kind", sql`${table.kind} in ('sms_segment','extraction_call','model_call','map_lookup','payment_fee')`),
  check("trip_usage_bounds", sql`${table.units} between 1 and 10000 and (${table.costMicros} is null or ${table.costMicros} >= 0)`),
]).enableRLS();

/** An operator's per-trip limit or kill switch for one usage kind. No row means the default bound applies. */
export const tripUsageControls = pgTable("trip_usage_controls", {
  commonsId: uuid("commons_id").notNull().references(() => commons.id, { onDelete: "cascade" }),
  kind: text("kind").$type<"sms_segment" | "extraction_call" | "model_call" | "map_lookup" | "payment_fee">().notNull(),
  limitUnits: integer("limit_units"),
  disabled: boolean("disabled").notNull().default(false),
  updatedByPersonId: uuid("updated_by_person_id").references(() => people.id, { onDelete: "set null" }),
  updatedAt,
}, table => [
  primaryKey({ columns: [table.commonsId, table.kind] }),
  check("trip_usage_controls_kind", sql`${table.kind} in ('sms_segment','extraction_call','model_call','map_lookup','payment_fee')`),
  check("trip_usage_controls_limit", sql`${table.limitUnits} is null or ${table.limitUnits} between 0 and 100000`),
]).enableRLS();

/** Append-only record of what an operator did about a failure or inquiry. The latest row decides whether it is reviewed or resolved. */
export const operatorActions = pgTable("operator_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorPersonId: uuid("operator_person_id").notNull().references(() => people.id, { onDelete: "restrict" }),
  subjectKind: text("subject_kind").$type<"partner_inquiry" | "notification" | "invitation" | "digest" | "intake" | "feedback" | "usage_control">().notNull(),
  subjectId: text("subject_id").notNull(),
  action: text("action").$type<"reviewed" | "resolved" | "reopened" | "retry_requested" | "control_changed">().notNull(),
  note: text("note"),
  createdAt,
}, table => [
  index("operator_actions_subject_idx").on(table.subjectKind, table.subjectId, table.createdAt),
  check("operator_actions_kind", sql`${table.subjectKind} in ('partner_inquiry','notification','invitation','digest','intake','feedback','usage_control')`),
  check("operator_actions_action", sql`${table.action} in ('reviewed','resolved','reopened','retry_requested','control_changed')`),
  check("operator_actions_bounds", sql`length(${table.subjectId}) between 1 and 80 and (${table.note} is null or length(${table.note}) <= 300)`),
]).enableRLS();
export * from "./messaging-schema";

/** Saved estimates are separate from the expense ledger. */
export const tripBudgetWorksheets = pgTable("trip_budget_worksheets", {
  commonsId: uuid("commons_id").primaryKey().references(() => commons.id, { onDelete: "cascade" }),
  inputs: jsonb("inputs").$type<Record<string, unknown>>().notNull(),
  version: integer("version").notNull().default(1),
  updatedByPersonId: uuid("updated_by_person_id").references(() => people.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/**
 * Settings for this copy of Commons: one row (id 1). The first account to sign in becomes the instance admin and chooses who may create an
 * account. `invitationTokenKey` holds a generated key when COMMONS_INVITATION_TOKEN_KEY isn't set. Server-only: RLS on, no policies.
 */
export const instanceSettings = pgTable("instance_settings", {
  id: integer("id").primaryKey().default(1),
  adminPersonId: uuid("admin_person_id").references(() => people.id, { onDelete: "set null" }),
  signupMode: text("signup_mode").$type<"invited" | "domains" | "anyone">().notNull().default("invited"),
  allowedDomains: jsonb("allowed_domains").$type<string[]>().notNull().default([]),
  invitationTokenKey: text("invitation_token_key"),
  updatedByPersonId: uuid("updated_by_person_id").references(() => people.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("instance_settings_single_row", sql`${table.id} = 1`),
  check("instance_settings_signup_mode", sql`${table.signupMode} in ('invited','domains','anyone')`),
]).enableRLS();

/** When each person was last emailed about new Messages with Commons, and when they last opened their thread. At most one notice until they read it. */
export const messagingWebNudges = pgTable("messaging_web_nudges", {
  personId: uuid("person_id").primaryKey().references(() => people.id, { onDelete: "cascade" }),
  lastNudgedAt: timestamp("last_nudged_at", { withTimezone: true }),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();
