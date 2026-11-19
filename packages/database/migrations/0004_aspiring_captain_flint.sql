CREATE TYPE "public"."expense_split_method" AS ENUM('equal', 'exact', 'shares', 'percentage');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('draft', 'confirmed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."ledger_source" AS ENUM('thread', 'web', 'import');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('not_attached', 'attached', 'not_expected');--> statement-breakpoint
CREATE TABLE "expense_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_id" uuid NOT NULL,
	"person_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"title" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"paid_by_person_id" uuid NOT NULL,
	"created_by_person_id" uuid,
	"occurred_on" date NOT NULL,
	"category" text NOT NULL,
	"status" "expense_status" DEFAULT 'draft' NOT NULL,
	"split_method" "expense_split_method" NOT NULL,
	"receipt_status" "receipt_status" DEFAULT 'not_attached' NOT NULL,
	"source" "ledger_source" NOT NULL,
	"source_label" text NOT NULL,
	"external_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reimbursements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"commons_id" uuid NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"occurred_on" date NOT NULL,
	"source" "ledger_source" NOT NULL,
	"source_label" text NOT NULL,
	"external_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_expense_id_expenses_id_fk" FOREIGN KEY ("expense_id") REFERENCES "public"."expenses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_person_id_people_id_fk" FOREIGN KEY ("paid_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_created_by_person_id_people_id_fk" FOREIGN KEY ("created_by_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_commons_id_commons_id_fk" FOREIGN KEY ("commons_id") REFERENCES "public"."commons"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_from_person_id_people_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_to_person_id_people_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."people"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "expense_shares_expense_person_unique" ON "expense_shares" USING btree ("expense_id","person_id");--> statement-breakpoint
CREATE INDEX "expense_shares_person_idx" ON "expense_shares" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "expenses_commons_occurred_idx" ON "expenses" USING btree ("commons_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_commons_external_unique" ON "expenses" USING btree ("commons_id","external_id");--> statement-breakpoint
CREATE INDEX "reimbursements_commons_occurred_idx" ON "reimbursements" USING btree ("commons_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "reimbursements_commons_external_unique" ON "reimbursements" USING btree ("commons_id","external_id");
--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_amount_positive" CHECK ("amount_cents" > 0);
--> statement-breakpoint
ALTER TABLE "expense_shares" ADD CONSTRAINT "expense_shares_amount_nonnegative" CHECK ("amount_cents" >= 0);
--> statement-breakpoint
ALTER TABLE "reimbursements" ADD CONSTRAINT "reimbursements_amount_positive" CHECK ("amount_cents" > 0);
--> statement-breakpoint
ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.expense_shares ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.reimbursements ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "expenses_select_members"
ON public.expenses FOR SELECT
TO authenticated
USING (public.is_commons_member(commons_id));
--> statement-breakpoint
CREATE POLICY "expense_shares_select_members"
ON public.expense_shares FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.expenses expense
    WHERE expense.id = expense_id
      AND public.is_commons_member(expense.commons_id)
  )
);
--> statement-breakpoint
CREATE POLICY "reimbursements_select_members"
ON public.reimbursements FOR SELECT
TO authenticated
USING (public.is_commons_member(commons_id));
