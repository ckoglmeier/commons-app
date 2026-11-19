CREATE INDEX IF NOT EXISTS "event_creation_draft_people_person_idx"
ON "event_creation_draft_people" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE public.conversation_digest_deliveries ENABLE ROW LEVEL SECURITY;
