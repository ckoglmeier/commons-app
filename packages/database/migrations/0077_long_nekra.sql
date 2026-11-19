CREATE TABLE "confirmation_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"digest" text NOT NULL,
	"kind" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"draft" jsonb,
	"error_code" text,
	"lease_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "confirmation_intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "confirmation_intakes" ADD CONSTRAINT "confirmation_intakes_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation_intakes" ADD CONSTRAINT "confirmation_intakes_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "confirmation_intakes_owner_digest" ON "confirmation_intakes" USING btree ("commons_id","owner_person_id","digest","kind");--> statement-breakpoint
CREATE INDEX "confirmation_intakes_owner_status" ON "confirmation_intakes" USING btree ("commons_id","owner_person_id","status");