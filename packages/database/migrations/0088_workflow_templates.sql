CREATE TABLE "workflow_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"version" integer NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"purpose" text NOT NULL,
	"instructions" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"authored_by" text NOT NULL,
	"save_command_id" uuid NOT NULL,
	"save_fingerprint" text NOT NULL,
	"activation_command_id" uuid,
	"activation_fingerprint" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workflow_templates_bounds" CHECK ("workflow_templates"."version" > 0 and "workflow_templates"."key" ~ '^[a-z][a-z0-9_]{2,63}$' and length("workflow_templates"."title") between 1 and 120 and length("workflow_templates"."description") between 1 and 500 and length("workflow_templates"."instructions") between 20 and 12000),
	CONSTRAINT "workflow_templates_status" CHECK ("workflow_templates"."status" in ('draft','active','retired')),
	CONSTRAINT "workflow_templates_purpose" CHECK ("workflow_templates"."purpose" in ('trip_feasibility','attendance_confirmation','lodging_selection','general_poll','itinerary'))
);
--> statement-breakpoint
ALTER TABLE "workflow_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_key_version" ON "workflow_templates" USING btree ("key","version");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_active_key" ON "workflow_templates" USING btree ("key") WHERE "workflow_templates"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_save_command" ON "workflow_templates" USING btree ("save_command_id");--> statement-breakpoint
CREATE UNIQUE INDEX "workflow_templates_activation_command" ON "workflow_templates" USING btree ("activation_command_id");
--> statement-breakpoint
-- Templates are private operator configuration, not participant-readable trip content.
REVOKE ALL ON "workflow_templates" FROM anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION preserve_workflow_version() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow revisions cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','activation_command_id','activation_fingerprint'])
    IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','activation_command_id','activation_fingerprint']) THEN
    RAISE EXCEPTION 'Save a new workflow revision instead of rewriting one';
  END IF;
  IF NOT ((OLD.status = 'draft' AND NEW.status = 'active'
      AND NEW.activation_command_id IS NOT NULL AND NEW.activation_fingerprint IS NOT NULL)
    OR (OLD.status = 'active' AND NEW.status = 'retired'
      AND NEW.activation_command_id IS NOT DISTINCT FROM OLD.activation_command_id
      AND NEW.activation_fingerprint IS NOT DISTINCT FROM OLD.activation_fingerprint)) THEN
    RAISE EXCEPTION 'Invalid workflow activation transition';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION preserve_workflow_version() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE OR DELETE ON workflow_templates
  FOR EACH ROW EXECUTE FUNCTION preserve_workflow_version();
--> statement-breakpoint
INSERT INTO workflow_templates (key, version, title, description, purpose, instructions, status, authored_by, save_command_id, save_fingerprint)
VALUES
('trip_feasibility', 1, 'Find dates and a destination', 'Ask the group which dates and locations work, without reopening settled decisions.', 'trip_feasibility',
$$Ask only what is still undecided: trip dates and/or destination. Reuse saved facts and approved decisions. If dates or destination are already settled, do not ask them again unless the organizer explicitly wants to reconsider. Use choose-all-that-work questions for supplied date windows and destinations; retain linked date-and-place alternatives when they depend on each other. Include a neither-works option, exclusive of workable choices. Never invent dates, places or availability. When essential candidate windows or locations are missing, ask one focused follow-up rather than producing a ready poll with no questions. Keep the group message short, explain what this poll decides, and distinguish tentative ideas from commitments. Do not add budgets, lodging properties or profile questions by default. Responses inform an organizer decision, not a saved change to trip dates or location.$$, 'active', 'migration', '97000000-0000-4000-8000-000000000001', 'seed:trip_feasibility:1'),
('attendance_confirmation', 1, 'Confirm who is coming', 'Get a final attendance answer for a trip with agreed dates and location.', 'attendance_confirmation',
$$State the agreed trip dates and destination in a concise group message and ask who is in. If the trip dates or destination are not settled, ask the organizer for the missing decision first; this is not a date-finding poll. Use a single-choice attendance question with clear yes and no answers; include an uncertainty option only if the organizer wants one. Ask about guests or babies only when it affects this trip and remains unresolved. Preserve explicit attendance already reported by the organizer instead of gratuitously reconfirming it. Poll answers are reported planning input, not an RSVP save, booking or verified account identity. Never infer attendance for silent participants or convert a name into an account.$$, 'active', 'migration', '97000000-0000-4000-8000-000000000002', 'seed:attendance_confirmation:1'),
('lodging_selection', 1, 'Choose where to stay', 'Compare workable lodging options with clear costs, room setups and hotel links.', 'lodging_selection',
$$Present a small, varied shortlist of actual organizer-supplied lodging properties rather than only luxury choices. Three options is a useful target, not permission to invent a third. If no shortlist exists, ask for it or offer supported research; do not fabricate properties, prices or live availability. Prefer a multiple-choice question asking which hotels work for each traveler, not a generic willingness-to-pay slider. Give each option a short description, why it fits, and its exact supplied hotel-page link. Preserve supplied price basis (per room or per person, per night or total), dates, nights, taxes/fees caveats and whether it is an estimate. Unknown costs remain unknown. Preserve own-bed versus shared-bed distinctions, king-only inventory and direct self-booking responsibility. Ask room-sharing preferences only if useful and still unresolved. Use only prices and links supplied in the current organizer request under the application rules; never turn snippets or model memory into quotes. The outcome helps choose the hotel/location, not book rooms or commit travelers.$$, 'active', 'migration', '97000000-0000-4000-8000-000000000003', 'seed:lodging_selection:1'),
('general_poll', 1, 'Ask another group question', 'Build a concise poll for decisions that do not need a guided trip workflow.', 'general_poll',
$$Turn the organizer's question into the smallest useful group poll. Support single-choice, choose-all-that-work or written responses according to the decision. Use only supplied choices and facts. If the goal or essential choices are missing, ask one focused question first. Do not add attendance, budget, dates, preferences or onboarding questions unless requested. The participant message should explain the decision briefly and make answering easy. Keep decisions tentative until the organizer reviews the results. Never imply that voting changes trip records, sends anything, commits spending or makes a booking.$$, 'active', 'migration', '97000000-0000-4000-8000-000000000004', 'seed:general_poll:1'),
('itinerary', 1, 'Build and refine an itinerary', 'Turn organizer commentary and selected sources into a paced, reviewable itinerary draft.', 'itinerary',
$$Build one paced itinerary from organizer-selected commentary, saved trip constraints and supplied evidence. Reuse the same draft during refinements. Saved dates, lodging, flights and organizer corrections outrank imported suggestions. Preserve important activity preferences, intentional downtime and optional participation. Group geographically sensible stops without inventing drive times, hours, prices or availability. Offer incompatible stops as alternatives. Include useful transport candidates, a driver brief and human follow-up tasks; internal research is not a traveler task. Retain source references and clearly mark unsourced ideas. Keep unknown times unresolved. Saving each activity, transport item or linked task requires explicit human approval through the application. Research claims are not reservations, and this workflow cannot book, send or change trip records.$$, 'active', 'migration', '97000000-0000-4000-8000-000000000005', 'seed:itinerary:1');
