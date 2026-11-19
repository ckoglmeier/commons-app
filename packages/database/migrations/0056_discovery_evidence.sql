CREATE TABLE "discovery_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"supplied_by_person_id" uuid NOT NULL,
	"audience" text NOT NULL,
	"identity_key" text NOT NULL,
	"record" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "discovery_evidence_audience_check" CHECK ("discovery_evidence"."audience" in ('private', 'event'))
);
--> statement-breakpoint
CREATE TABLE "inventory_checks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"evidence_id" uuid NOT NULL,
	"requested_by_person_id" uuid NOT NULL,
	"provider_id" text NOT NULL,
	"cache_key" text NOT NULL,
	"selection" jsonb NOT NULL,
	"request" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_code" text,
	"history" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_checks_status_check" CHECK ("inventory_checks"."status" in ('pending', 'processing', 'succeeded', 'failed')),
	CONSTRAINT "inventory_checks_attempts_check" CHECK ("inventory_checks"."attempts" between 0 and 5)
);
--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "discovery_evidence" ADD CONSTRAINT "discovery_evidence_supplied_by_person_id_people_id_fk" FOREIGN KEY ("supplied_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_requested_by_person_id_people_id_fk" FOREIGN KEY ("requested_by_person_id") REFERENCES "public"."people"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_evidence_event_id_unique" ON "discovery_evidence" USING btree ("commons_id","id");--> statement-breakpoint
ALTER TABLE "inventory_checks" ADD CONSTRAINT "inventory_checks_event_evidence_fk" FOREIGN KEY ("commons_id","evidence_id") REFERENCES "public"."discovery_evidence"("commons_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "discovery_evidence_identity_unique" ON "discovery_evidence" USING btree ("commons_id","supplied_by_person_id","identity_key");--> statement-breakpoint
CREATE INDEX "inventory_checks_ready_idx" ON "inventory_checks" USING btree ("status","available_at");--> statement-breakpoint
CREATE INDEX "inventory_checks_event_idx" ON "inventory_checks" USING btree ("commons_id","evidence_id");--> statement-breakpoint
CREATE INDEX "inventory_checks_cache_idx" ON "inventory_checks" USING btree ("commons_id","requested_by_person_id","cache_key");
--> statement-breakpoint
ALTER TABLE public.discovery_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_checks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.discovery_evidence, public.inventory_checks FROM anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION public.preserve_discovery_original() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  RAISE EXCEPTION 'Discovery evidence is immutable; capture a new source revision.';
END;
$$;
CREATE TRIGGER discovery_original_immutable BEFORE UPDATE ON public.discovery_evidence
FOR EACH ROW EXECUTE FUNCTION public.preserve_discovery_original();
REVOKE ALL ON FUNCTION public.preserve_discovery_original() FROM PUBLIC, anon, authenticated;
