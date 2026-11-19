ALTER TABLE "confirmation_documents" DROP CONSTRAINT "confirmation_documents_pdf_only";--> statement-breakpoint
ALTER TABLE "travel_plans" ADD COLUMN "connections" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "confirmation_documents" ADD CONSTRAINT "confirmation_documents_supported_type" CHECK ("confirmation_documents"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'message/rfc822'));--> statement-breakpoint
UPDATE storage.buckets SET allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'text/plain', 'message/rfc822'] WHERE id = 'commons-confirmations';
