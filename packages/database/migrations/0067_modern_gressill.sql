CREATE TABLE "beta_organizer_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"invited_by_person_id" uuid NOT NULL,
	"claimed_by_person_id" uuid,
	"sent_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "beta_organizer_invites_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "beta_organizer_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON public.beta_organizer_invites FROM anon, authenticated;--> statement-breakpoint
ALTER TABLE "beta_organizer_invites" ADD CONSTRAINT "beta_organizer_invites_invited_by_person_id_people_id_fk" FOREIGN KEY ("invited_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "beta_organizer_invites" ADD CONSTRAINT "beta_organizer_invites_claimed_by_person_id_people_id_fk" FOREIGN KEY ("claimed_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;
