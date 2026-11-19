ALTER TABLE "memberships" ADD COLUMN "attendance_state" text DEFAULT 'helping' NOT NULL;--> statement-breakpoint
ALTER TABLE "memberships" ADD COLUMN "attendance_dates" text;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_attendance_state_check" CHECK ("memberships"."attendance_state" in ('helping', 'attending', 'declined'));