import { getTableName } from "drizzle-orm";
import assert from "node:assert/strict";
import test from "node:test";
import {
  auditEvents,
  commons,
  consentEvents,
  conversationDigestDeliveries,
  conversationDigestItems,
  expenseShares,
  expenses,
  eventCreationDraftPeople,
  eventCreationDrafts,
  feedbackSubmissions,
  identities,
  invitations,
  itineraryItems,
  memberships,
  messages,
  moments,
  people,
  participation,
  pollResponses,
  polls,
  processedCommands,
  proposalEvidence,
  proposals,
  reimbursements,
  stayParticipants,
  stays,
  travelerProfiles,
} from "./schema";

test("exports the complete persistence boundary for the approval slice", () => {
  assert.deepEqual(
    [
      people,
      identities,
      invitations,
      commons,
      memberships,
      consentEvents,
      conversationDigestDeliveries,
      conversationDigestItems,
      expenses,
      expenseShares,
      reimbursements,
      moments,
      feedbackSubmissions,
      messages,
      proposals,
      proposalEvidence,
      itineraryItems,
      participation,
      auditEvents,
      processedCommands,
      eventCreationDrafts,
      eventCreationDraftPeople,
      polls,
      pollResponses,
      stays,
      stayParticipants,
    ].map(getTableName),
    [
      "people",
      "identities",
      "invitations",
      "commons",
      "memberships",
      "consent_events",
      "conversation_digest_deliveries",
      "conversation_digest_items",
      "expenses",
      "expense_shares",
      "reimbursements",
      "moments",
      "feedback_submissions",
      "messages",
      "proposals",
      "proposal_evidence",
      "itinerary_items",
      "participation",
      "audit_events",
      "processed_commands",
      "event_creation_drafts",
      "event_creation_draft_people",
      "polls",
      "poll_responses",
      "stays",
      "stay_participants",
    ],
  );
});

test("requires only a name among the foundational Commons details", () => {
  assert.equal(commons.name.notNull, true);
  assert.equal(commons.locationName.notNull, false);
  assert.equal(commons.startsOn.notNull, false);
  assert.equal(commons.endsOn.notNull, false);
});

test("tracks setup completion and invitation delivery separately", () => {
  assert.equal(commons.setupCompletedAt.notNull, false);
  assert.equal(commons.firstSharedAt.notNull, false);
  assert.equal(invitations.recipientEmail.notNull, false);
  assert.equal(invitations.deliveryState.notNull, true);
  assert.equal(invitations.deliveryState.default, "not_sent");
});

test("keeps daily email preference explicit and backward-compatible", () => {
  assert.equal(travelerProfiles.dailyDigestEnabled.notNull, true);
  assert.equal(travelerProfiles.dailyDigestEnabled.default, true);
});

test("stores reusable traveler preferences with per-field attribution", () => {
  assert.equal(travelerProfiles.usualOriginLabel.notNull, false);
  assert.equal(travelerProfiles.dietaryPreferences.notNull, false);
  assert.equal(travelerProfiles.accessibilityNeeds.notNull, false);
  assert.equal(travelerProfiles.lodgingPreferences.notNull, false);
  assert.equal(travelerProfiles.transportationPreferences.notNull, false);
  assert.equal(travelerProfiles.dietaryPreferencesSuppliedByPersonId.notNull, false);
});
