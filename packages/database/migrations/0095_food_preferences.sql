ALTER TABLE recipe_runs DROP CONSTRAINT recipe_runs_recipe;
--> statement-breakpoint
ALTER TABLE recipe_runs ADD CONSTRAINT recipe_runs_recipe CHECK (recipe in ('dates_location','attendance','lodging','food_preferences','transport','itinerary','custom_poll'));
--> statement-breakpoint
ALTER TABLE recipe_outcomes DROP CONSTRAINT recipe_outcomes_kind;
--> statement-breakpoint
ALTER TABLE recipe_outcomes ADD CONSTRAINT recipe_outcomes_kind CHECK (kind in ('dates_location','attendance','lodging','food_preferences'));
