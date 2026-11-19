CREATE TYPE "public"."stay_status" AS ENUM('considering', 'planned', 'confirmed');--> statement-breakpoint
CREATE TABLE "stays" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"created_by_person_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"check_in_time" text,
	"check_out_time" text,
	"status" "stay_status" DEFAULT 'considering' NOT NULL,
	"booking_url" text,
	"poll_id" uuid,
	"confirmation_code" text,
	"total_cents" integer,
	"currency" text DEFAULT 'USD' NOT NULL,
	"details" text,
	"source_label" text NOT NULL,
	"legacy_expense_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "stay_participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stay_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_poll_id_polls_id_fk" FOREIGN KEY ("poll_id") REFERENCES "public"."polls"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_legacy_expense_id_expenses_id_fk" FOREIGN KEY ("legacy_expense_id") REFERENCES "public"."expenses"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_participants" ADD CONSTRAINT "stay_participants_stay_id_stays_id_fk" FOREIGN KEY ("stay_id") REFERENCES "public"."stays"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stay_participants" ADD CONSTRAINT "stay_participants_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stays_commons_dates_idx" ON "stays" USING btree ("commons_id","starts_on","ends_on");--> statement-breakpoint
CREATE UNIQUE INDEX "stays_legacy_expense_unique" ON "stays" USING btree ("legacy_expense_id");--> statement-breakpoint
CREATE UNIQUE INDEX "stay_participants_stay_person_unique" ON "stay_participants" USING btree ("stay_id","person_id");--> statement-breakpoint
CREATE INDEX "stay_participants_person_idx" ON "stay_participants" USING btree ("person_id");--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_dates_valid" CHECK ("ends_on" >= "starts_on");--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_total_positive" CHECK ("total_cents" IS NULL OR "total_cents" > 0);--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_check_in_time_valid" CHECK ("check_in_time" IS NULL OR "check_in_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
ALTER TABLE "stays" ADD CONSTRAINT "stays_check_out_time_valid" CHECK ("check_out_time" IS NULL OR "check_out_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');--> statement-breakpoint
INSERT INTO "stays" (
	"commons_id", "created_by_person_id", "name", "address", "starts_on", "ends_on",
	"status", "confirmation_code", "total_cents", "currency", "details", "source_label",
	"legacy_expense_id", "created_at", "updated_at"
)
SELECT
	e."commons_id",
	COALESCE(e."created_by_person_id", e."paid_by_person_id"),
	i."title",
	i."location_name",
	i."starts_at"::date,
	i."ends_at"::date,
	CASE
		WHEN i."status" = 'confirmed' THEN 'confirmed'::"stay_status"
		WHEN i."status" = 'planned' THEN 'planned'::"stay_status"
		ELSE 'considering'::"stay_status"
	END,
	e."confirmation_code",
	e."amount_cents",
	e."currency",
	e."note",
	e."source_label",
	e."id",
	LEAST(e."created_at", i."created_at"),
	GREATEST(e."updated_at", i."updated_at")
FROM "expenses" e
INNER JOIN "itinerary_items" i ON i."id" = e."itinerary_item_id"
WHERE e."category" = 'Lodging'
	AND i."starts_at" IS NOT NULL
	AND i."ends_at" IS NOT NULL
	AND i."location_name" IS NOT NULL
ON CONFLICT ("legacy_expense_id") DO NOTHING;--> statement-breakpoint
INSERT INTO "stay_participants" ("stay_id", "person_id")
SELECT s."id", m."person_id"
FROM "stays" s
INNER JOIN "memberships" m ON m."commons_id" = s."commons_id"
WHERE m."status" IN ('active', 'invited')
ON CONFLICT ("stay_id", "person_id") DO NOTHING;--> statement-breakpoint
ALTER TABLE public.stays ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE public.stay_participants ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "stays_select_members"
ON public.stays FOR SELECT
TO authenticated
USING (public.is_commons_member(commons_id));--> statement-breakpoint
CREATE POLICY "stay_participants_select_members"
ON public.stay_participants FOR SELECT
TO authenticated
USING (
	EXISTS (
		SELECT 1
		FROM public.stays stay
		WHERE stay.id = stay_id
			AND public.is_commons_member(stay.commons_id)
	)
);
