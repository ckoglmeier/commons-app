CREATE TABLE "conversation_digest_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"source_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"delivery_id" uuid,
	"included_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_digest_items" ADD CONSTRAINT "conversation_digest_items_recipient_person_id_people_id_fk" FOREIGN KEY ("recipient_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_digest_items" ADD CONSTRAINT "conversation_digest_items_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "conversation_digest_items" ADD CONSTRAINT "conversation_digest_items_delivery_id_conversation_digest_deliveries_id_fk" FOREIGN KEY ("delivery_id") REFERENCES "public"."conversation_digest_deliveries"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "conversation_digest_item_source_unique" ON "conversation_digest_items" USING btree ("recipient_person_id","source_type","source_id");
--> statement-breakpoint
CREATE INDEX "conversation_digest_items_pending_idx" ON "conversation_digest_items" USING btree ("delivery_id","created_at");
--> statement-breakpoint
ALTER TABLE public.conversation_digest_items ENABLE ROW LEVEL SECURITY;
