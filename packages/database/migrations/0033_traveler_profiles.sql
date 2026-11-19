CREATE TABLE "traveler_profiles" (
	"person_id" uuid PRIMARY KEY NOT NULL,
	"usual_origin_label" text,
	"profile_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "traveler_profiles" ADD CONSTRAINT "traveler_profiles_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.traveler_profiles ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "traveler_profiles_select_own"
ON public.traveler_profiles FOR SELECT
TO authenticated
USING (EXISTS (SELECT 1 FROM public.people person WHERE person.id = person_id AND person.auth_user_id = auth.uid()));--> statement-breakpoint
CREATE POLICY "traveler_profiles_update_own"
ON public.traveler_profiles FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.people person WHERE person.id = person_id AND person.auth_user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.people person WHERE person.id = person_id AND person.auth_user_id = auth.uid()));
--> statement-breakpoint
CREATE POLICY "traveler_profiles_insert_own"
ON public.traveler_profiles FOR INSERT
TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.people person WHERE person.id = person_id AND person.auth_user_id = auth.uid()));
