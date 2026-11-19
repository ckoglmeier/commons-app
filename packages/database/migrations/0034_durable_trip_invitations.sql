ALTER TABLE "invitations" ALTER COLUMN "expires_at" DROP NOT NULL;
--> statement-breakpoint
UPDATE "invitations"
SET "expires_at" = NULL,
    "status" = CASE
      WHEN "status" = 'expired' AND "token_value" IS NOT NULL THEN 'pending'
      ELSE "status"
    END,
    "updated_at" = now()
WHERE "expires_at" IS NOT NULL OR "status" = 'expired';
