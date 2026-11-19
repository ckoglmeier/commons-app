CREATE TABLE "invitation_delivery_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"invitation_id" uuid NOT NULL,
	"token_version" integer NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"provider_message_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_value" text;--> statement-breakpoint
ALTER TABLE "invitations" ADD COLUMN "token_version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "invitation_delivery_attempts" ADD CONSTRAINT "invitation_delivery_attempts_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitation_delivery_attempts" ADD CONSTRAINT "invitation_delivery_attempts_invitation_id_invitations_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."invitations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "invitation_delivery_attempts_ready_idx" ON "invitation_delivery_attempts" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "invitation_delivery_attempts_invitation_idx" ON "invitation_delivery_attempts" USING btree ("invitation_id");--> statement-breakpoint
ALTER TABLE public.invitation_delivery_attempts ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "invitation_delivery_attempts_select_organizers"
ON public.invitation_delivery_attempts FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.memberships
    WHERE memberships.commons_id = invitation_delivery_attempts.commons_id
      AND memberships.person_id = public.current_person_id()
      AND memberships.role = 'organizer'
      AND memberships.status = 'active'
  )
);
