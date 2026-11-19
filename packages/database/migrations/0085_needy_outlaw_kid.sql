ALTER TABLE "trip_tasks" ALTER COLUMN "item_kind" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_tasks" ALTER COLUMN "item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trip_tasks" ADD CONSTRAINT "trip_tasks_item_pair" CHECK (("trip_tasks"."item_kind" IS NULL) = ("trip_tasks"."item_id" IS NULL));