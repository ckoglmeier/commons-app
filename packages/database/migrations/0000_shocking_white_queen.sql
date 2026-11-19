CREATE TYPE "public"."actor_type" AS ENUM('human', 'commons', 'agent');--> statement-breakpoint
CREATE TYPE "public"."commons_status" AS ENUM('planning', 'active', 'closing', 'archived');--> statement-breakpoint
CREATE TYPE "public"."identity_kind" AS ENUM('phone', 'email', 'imessage_handle', 'whatsapp_handle');--> statement-breakpoint
CREATE TYPE "public"."identity_state" AS ENUM('observed', 'channel_verified', 'claimed');--> statement-breakpoint
CREATE TYPE "public"."itinerary_status" AS ENUM('planned', 'confirmed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'leased', 'complete', 'failed');--> statement-breakpoint
CREATE TYPE "public"."membership_role" AS ENUM('organizer', 'member');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('invited', 'active', 'left', 'removed');--> statement-breakpoint
CREATE TYPE "public"."message_source" AS ENUM('channel', 'web');--> statement-breakpoint
CREATE TYPE "public"."participation_status" AS ENUM('in', 'maybe', 'skip');--> statement-breakpoint
CREATE TYPE "public"."proposal_scope" AS ENUM('everyone', 'subgroup', 'individual');--> statement-breakpoint
CREATE TYPE "public"."proposal_status" AS ENUM('proposed', 'approved', 'rejected', 'expired', 'superseded');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"actor_id" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text NOT NULL,
	"summary" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "commons" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"location_name" text,
	"timezone" text NOT NULL,
	"status" "commons_status" DEFAULT 'planning' NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"scope" text NOT NULL,
	"notice_version" text NOT NULL,
	"action" text NOT NULL,
	"source" text NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"kind" "identity_kind" NOT NULL,
	"display_value_encrypted" text,
	"normalized_hash" text NOT NULL,
	"state" "identity_state" DEFAULT 'observed' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itinerary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"source_proposal_id" uuid,
	"title" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"timezone" text NOT NULL,
	"location_name" text,
	"audience" "proposal_scope" NOT NULL,
	"status" "itinerary_status" DEFAULT 'planned' NOT NULL,
	"provenance_label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"role" "membership_role" DEFAULT 'member' NOT NULL,
	"status" "membership_status" DEFAULT 'invited' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"actor_person_id" uuid,
	"actor_name" text NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"body" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" "message_source" NOT NULL,
	"source_event_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"status" "participation_status" NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "processed_commands" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"command_id" text NOT NULL,
	"result" jsonb NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposal_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"proposal_id" uuid NOT NULL,
	"message_id" uuid NOT NULL,
	"excerpt" text NOT NULL,
	"relevance" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "proposals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "proposal_status" DEFAULT 'proposed' NOT NULL,
	"scope" "proposal_scope" NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"approved_by_person_id" uuid,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "commons" ADD CONSTRAINT "commons_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_events" ADD CONSTRAINT "consent_events_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identities" ADD CONSTRAINT "identities_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itinerary_items" ADD CONSTRAINT "itinerary_items_source_proposal_id_proposals_id_fk" FOREIGN KEY ("source_proposal_id") REFERENCES "public"."proposals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_actor_person_id_people_id_fk" FOREIGN KEY ("actor_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation" ADD CONSTRAINT "participation_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processed_commands" ADD CONSTRAINT "processed_commands_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_proposal_id_proposals_id_fk" FOREIGN KEY ("proposal_id") REFERENCES "public"."proposals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposal_evidence" ADD CONSTRAINT "proposal_evidence_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_approved_by_person_id_people_id_fk" FOREIGN KEY ("approved_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audit_events_commons_command_unique" ON "audit_events" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE INDEX "audit_events_commons_occurred_idx" ON "audit_events" USING btree ("commons_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "commons_slug_unique" ON "commons" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "consent_events_commons_person_idx" ON "consent_events" USING btree ("commons_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "identities_kind_hash_unique" ON "identities" USING btree ("kind","normalized_hash");--> statement-breakpoint
CREATE INDEX "identities_person_idx" ON "identities" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "itinerary_commons_starts_idx" ON "itinerary_items" USING btree ("commons_id","starts_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_commons_sequence_unique" ON "jobs" USING btree ("commons_id","sequence");--> statement-breakpoint
CREATE INDEX "jobs_ready_idx" ON "jobs" USING btree ("status","available_at");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_commons_person_unique" ON "memberships" USING btree ("commons_id","person_id");--> statement-breakpoint
CREATE INDEX "memberships_person_idx" ON "memberships" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_commons_sequence_unique" ON "messages" USING btree ("commons_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_commons_source_event_unique" ON "messages" USING btree ("commons_id","source_event_id");--> statement-breakpoint
CREATE INDEX "messages_commons_occurred_idx" ON "messages" USING btree ("commons_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "participation_item_person_unique" ON "participation" USING btree ("itinerary_item_id","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "people_auth_user_id_unique" ON "people" USING btree ("auth_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "processed_commands_commons_command_unique" ON "processed_commands" USING btree ("commons_id","command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposal_evidence_proposal_message_unique" ON "proposal_evidence" USING btree ("proposal_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "proposals_id_version_unique" ON "proposals" USING btree ("id","version");--> statement-breakpoint
CREATE INDEX "proposals_commons_status_idx" ON "proposals" USING btree ("commons_id","status");