CREATE TABLE "messaging_money_intakes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"commons_id" uuid NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"source_text" text NOT NULL,
	"draft" jsonb NOT NULL,
	"missing" text,
	"record_id" uuid,
	"received_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_money_intakes_status" CHECK ("messaging_money_intakes"."status" in ('needs_info','awaiting_review','saved','declined','superseded')),
	CONSTRAINT "messaging_money_intakes_bounds" CHECK ("messaging_money_intakes"."version" > 0 and length("messaging_money_intakes"."source_text") <= 4000)
);
--> statement-breakpoint
ALTER TABLE "messaging_money_intakes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_phone_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"person_id" uuid NOT NULL,
	"phone_hash" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_phone_verifications_attempts" CHECK ("messaging_phone_verifications"."attempts" >= 0)
);
--> statement-breakpoint
ALTER TABLE "messaging_phone_verifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "messaging_money_intakes" ADD CONSTRAINT "messaging_money_intakes_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_money_intakes" ADD CONSTRAINT "messaging_money_intakes_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_phone_verifications" ADD CONSTRAINT "messaging_phone_verifications_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "messaging_money_intakes_person_idx" ON "messaging_money_intakes" USING btree ("person_id","commons_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "messaging_money_intakes_message" ON "messaging_money_intakes" USING btree ("received_message_id") WHERE "messaging_money_intakes"."received_message_id" is not null;--> statement-breakpoint
CREATE INDEX "messaging_phone_verifications_person_idx" ON "messaging_phone_verifications" USING btree ("person_id","created_at");--> statement-breakpoint
CREATE INDEX "messaging_phone_verifications_phone_idx" ON "messaging_phone_verifications" USING btree ("phone_hash","created_at");--> statement-breakpoint
CREATE INDEX "messaging_phone_verifications_created_idx" ON "messaging_phone_verifications" USING btree ("created_at");