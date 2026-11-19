CREATE TABLE "meal_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itinerary_item_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"confirmation_number" varchar(120) NOT NULL,
	"note" varchar(1000) NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_reservations" ADD CONSTRAINT "meal_reservations_itinerary_item_id_itinerary_items_id_fk" FOREIGN KEY ("itinerary_item_id") REFERENCES "public"."itinerary_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meal_reservations" ADD CONSTRAINT "meal_reservations_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meal_reservations_item_person_idx" ON "meal_reservations" USING btree ("itinerary_item_id","person_id");--> statement-breakpoint
ALTER TABLE "meal_reservations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "meal_reservations" FROM PUBLIC, anon, authenticated;
