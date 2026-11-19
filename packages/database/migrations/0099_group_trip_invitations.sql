CREATE TABLE "group_invitations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"protected_token" text,
	"version" integer DEFAULT 1 NOT NULL,
	"revoked_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_invitations_positive_version" CHECK ("group_invitations"."version" > 0)
);
--> statement-breakpoint
ALTER TABLE "group_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_invitations" ADD CONSTRAINT "group_invitations_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_commons_unique" ON "group_invitations" USING btree ("commons_id");--> statement-breakpoint
CREATE UNIQUE INDEX "group_invitations_token_hash_unique" ON "group_invitations" USING btree ("token_hash");