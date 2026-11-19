CREATE TABLE "confirmation_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"owner_person_id" uuid NOT NULL,
	"storage_path" text NOT NULL,
	"file_name" text NOT NULL,
	"mime_type" text DEFAULT 'application/pdf' NOT NULL,
	"stay_id" uuid,
	"travel_plan_id" uuid,
	"expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "confirmation_documents_pdf_only" CHECK ("confirmation_documents"."mime_type" = 'application/pdf'),
	CONSTRAINT "confirmation_documents_source_check" CHECK ("confirmation_documents"."stay_id" is not null or "confirmation_documents"."travel_plan_id" is not null or "confirmation_documents"."expense_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "legacy_expense_id" uuid;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_travel_plan_id_travel_plans_id_fk" FOREIGN KEY ("travel_plan_id") REFERENCES "public"."travel_plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "confirmation_documents_storage_unique" ON "confirmation_documents" USING btree ("storage_path");--> statement-breakpoint
CREATE UNIQUE INDEX "confirmation_documents_stay_unique" ON "confirmation_documents" USING btree ("stay_id");--> statement-breakpoint
CREATE UNIQUE INDEX "confirmation_documents_travel_unique" ON "confirmation_documents" USING btree ("travel_plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "confirmation_documents_expense_unique" ON "confirmation_documents" USING btree ("expense_id");--> statement-breakpoint
CREATE INDEX "confirmation_documents_commons_owner_idx" ON "confirmation_documents" USING btree ("commons_id","owner_person_id");--> statement-breakpoint
ALTER TABLE "travel_plans" ADD CONSTRAINT "travel_plans_legacy_expense_id_expenses_id_fk" FOREIGN KEY ("legacy_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "travel_plans_legacy_expense_unique" ON "travel_plans" USING btree ("legacy_expense_id");
--> statement-breakpoint
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('commons-confirmations', 'commons-confirmations', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760, allowed_mime_types = ARRAY['application/pdf'];
--> statement-breakpoint
ALTER TABLE public.confirmation_documents ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY confirmation_documents_select_owner
ON public.confirmation_documents FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.people
    WHERE people.id = confirmation_documents.owner_person_id
      AND people.auth_user_id = (SELECT auth.uid())
  )
  AND EXISTS (
    SELECT 1 FROM public.memberships
    WHERE memberships.commons_id = confirmation_documents.commons_id
      AND memberships.person_id = confirmation_documents.owner_person_id
      AND memberships.status = 'active'
  )
);
