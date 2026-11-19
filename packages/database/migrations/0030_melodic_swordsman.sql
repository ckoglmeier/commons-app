ALTER TABLE "polls" ADD COLUMN "public_id" varchar(12) DEFAULT lower(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)) NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "polls_public_id_unique" ON "polls" USING btree ("public_id");--> statement-breakpoint
ALTER TABLE "polls" ADD CONSTRAINT "polls_public_id_format_check" CHECK ("polls"."public_id" ~ '^[0-9a-f]{12}$');