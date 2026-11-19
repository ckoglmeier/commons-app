CREATE TABLE "instance_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"admin_person_id" uuid,
	"signup_mode" text DEFAULT 'invited' NOT NULL,
	"allowed_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"invitation_token_key" text,
	"updated_by_person_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instance_settings_single_row" CHECK ("instance_settings"."id" = 1),
	CONSTRAINT "instance_settings_signup_mode" CHECK ("instance_settings"."signup_mode" in ('invited','domains','anyone'))
);
--> statement-breakpoint
ALTER TABLE "instance_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "messaging_web_nudges" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"last_nudged_at" timestamp with time zone,
	"last_read_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messaging_web_nudges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_admin_person_id_people_id_fk" FOREIGN KEY ("admin_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_updated_by_person_id_people_id_fk" FOREIGN KEY ("updated_by_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_web_nudges" ADD CONSTRAINT "messaging_web_nudges_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;