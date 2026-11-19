-- Restore the no-sign-in lodging poll explicitly requested by its organizer.
-- Verified in production: this exact poll is open with zero responses.
-- Do not alter any other poll, membership, invitation, question, or response.
UPDATE polls SET audience = NULL, updated_at = now()
WHERE public_id = '62750ac6ef67'
  AND commons_id = '6b043aa5-4c4d-4515-a884-e3d1c9fa9968'::uuid
  AND status = 'open'
  AND audience IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM poll_responses WHERE poll_id = polls.id);
