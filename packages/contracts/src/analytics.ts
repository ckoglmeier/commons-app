import { z } from "zod";

export const ProductAnalyticsEventNameSchema = z.enum([
  "page_view",
  "account_setup_completed",
  "poll_published",
  "demo_opened",
  "walkthrough_started",
  "walkthrough_step_viewed",
  "walkthrough_exited",
  "walkthrough_completed",
  "feedback_opened",
  "feedback_submitted",
  "sign_in_started",
  "trip_create_started",
  "trip_created",
  "event_creation_viewed",
  "event_description_submitted",
  "recent_event_selected",
  "event_setup_reviewed",
  "event_person_added",
  "event_person_removed",
  "event_creation_committed",
  "event_creation_access_requested",
  "event_creation_abandoned",
  "event_creation_blocked_unsupported_type",
  "trip_opened",
  "trip_arrival_entered",
  "trip_arrival_reopened",
  "trip_tab_viewed",
  "trip_title_updated",
  "trip_details_opened",
  "trip_details_updated",
  "money_settings_updated",
  "stay_added",
  "stay_updated",
  "stay_removed",
  "people_opened",
  "invitation_sent",
  "invitation_link_copied",
  "invitation_link_replaced",
  "invitation_revoked",
  "plan_added",
  "expense_added",
  "payment_recorded",
  "expenses_marked_complete",
  "expenses_closed",
  "expenses_reopened",
  "photo_upload_started",
  "photo_added",
  "proposal_approved",
  "group_message_sent",
  "concierge_import_opened",
  "concierge_import_email_clicked",
  // Poll drafting and trip-entry events. Activation funnel facts that need deduplication
  // (first shared artifact, meaningful participant action, organizer return, repeats) are derived from saved records in
  // the daily report, not from these client events.
  "poll_draft_started",
  "poll_assist_requested",
  "poll_assist_applied",
  "poll_assist_failed",
  "participant_trip_start_clicked",
  "held_feature_link_opened",
  // Persisted outcomes recorded by the server after a command commits (apps/web/lib/server/outcome-telemetry.ts).
  // trip_created, poll_published, expense_added and payment_recorded are reused with properties.source = "server".
  "invitation_accepted",
  "group_joined",
  "poll_response_saved",
  "poll_decision_recorded",
  "plan_item_saved",
  "operation_failed",
  "server_error",
  // One row per poll-help provider call (success or failure) with model, latency, tokens and cost coverage.
  "poll_assist_generation",
]);

const AnalyticsPropertyValueSchema = z.union([
  z.string().max(255),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

export const TrackProductAnalyticsEventRequestSchema = z.object({
  eventName: ProductAnalyticsEventNameSchema,
  anonymousId: z.uuid(),
  sessionId: z.uuid(),
  commonsSlug: z.string().trim().min(1).max(120).optional(),
  pagePath: z.string().trim().min(1).max(500).startsWith("/"),
  referrer: z.string().trim().max(1_000).optional(),
  properties: z.record(z.string().max(60), AnalyticsPropertyValueSchema)
    .refine((value) => Object.keys(value).length <= 20, "Too many analytics properties."),
  occurredAt: z.iso.datetime(),
});

export type ProductAnalyticsEventName = z.infer<typeof ProductAnalyticsEventNameSchema>;
export type TrackProductAnalyticsEventRequest = z.infer<typeof TrackProductAnalyticsEventRequestSchema>;
