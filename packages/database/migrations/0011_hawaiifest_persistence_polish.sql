UPDATE "messages"
SET "body" = 'Cross Knob, Horine Reservation, and Road to Hanekamp’s are a few hiking options.'
WHERE "id" = '97020000-0000-4000-8000-000000000010'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE "messages"
SET "body" = 'Gralehaus · Louisville, Kentucky'
WHERE "id" = '97020000-0000-4000-8000-000000000015'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE "messages"
SET "body" = 'Thanks for getting money settled Mike, I''m paying now'
WHERE "id" = '97020000-0000-4000-8000-000000000020'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE "itinerary_items"
SET
  "title" = 'Road to Hanekamp’s loop',
  "location_name" = 'Abbey of Gethsemani, New Haven',
  "note" = '5.2-mile loop · about 2 hours',
  "provenance_label" = 'Chosen from Rainey’s three hiking options',
  "updated_at" = now()
WHERE "id" = '97030000-0000-4000-8000-000000000005'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE "itinerary_items"
SET
  "note" = 'Cheese, ground beef, buns, tomatoes, salad greens, oat milk, and condiments',
  "updated_at" = now()
WHERE "id" = '97030000-0000-4000-8000-000000000007'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
UPDATE "itinerary_items"
SET
  "note" = 'Burgers and salad at the house',
  "updated_at" = now()
WHERE "id" = '97030000-0000-4000-8000-000000000008'
  AND "commons_id" = '90000000-0000-4000-8000-000000000002';
--> statement-breakpoint
INSERT INTO "reimbursements" (
  "id",
  "commons_id",
  "from_person_id",
  "to_person_id",
  "amount_cents",
  "currency",
  "occurred_on",
  "source",
  "source_label",
  "external_id"
)
SELECT
  seed."id"::uuid,
  '90000000-0000-4000-8000-000000000002'::uuid,
  seed."from_person_id"::uuid,
  '30000000-0000-4000-8000-000000000010'::uuid,
  seed."amount_cents",
  'USD',
  '2026-08-27'::date,
  'import'::"ledger_source",
  'Marked settled by the organizer · no money moved by Commons',
  seed."external_id"
FROM (
  VALUES
    ('97060000-0000-4000-8000-000000000004', '30000000-0000-4000-8000-000000000001', 102590, 'splitwise-hawaiifest-2k25-payment-4'),
    ('97060000-0000-4000-8000-000000000005', '30000000-0000-4000-8000-000000000003', 90124, 'splitwise-hawaiifest-2k25-payment-5'),
    ('97060000-0000-4000-8000-000000000006', '30000000-0000-4000-8000-000000000011', 66789, 'splitwise-hawaiifest-2k25-payment-6')
) AS seed("id", "from_person_id", "amount_cents", "external_id")
WHERE EXISTS (
  SELECT 1
  FROM "commons"
  WHERE "id" = '90000000-0000-4000-8000-000000000002'
)
AND EXISTS (
  SELECT 1
  FROM "people"
  WHERE "id" = seed."from_person_id"::uuid
)
AND EXISTS (
  SELECT 1
  FROM "people"
  WHERE "id" = '30000000-0000-4000-8000-000000000010'
)
ON CONFLICT ("id") DO UPDATE SET
  "amount_cents" = EXCLUDED."amount_cents",
  "occurred_on" = EXCLUDED."occurred_on",
  "source_label" = EXCLUDED."source_label",
  "updated_at" = now();
