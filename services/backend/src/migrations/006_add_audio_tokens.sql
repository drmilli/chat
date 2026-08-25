-- Voice clips were served from /api/messages/:id/audio with no secret, so
-- anyone could walk the id space and download every voice note ever posted.
-- A per-message random token makes the URL unguessable while keeping it usable
-- in an <audio src>, which cannot send an Authorization header.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS audio_token TEXT;

-- Backfill existing clips so they keep playing.
-- gen_random_uuid() is core Postgres (no pgcrypto needed) and is seeded from a
-- cryptographic source; 122 bits of randomness is ample for an unguessable URL.
UPDATE messages
   SET audio_token = replace(gen_random_uuid()::text, '-', '')
 WHERE audio IS NOT NULL AND audio_token IS NULL;

CREATE INDEX IF NOT EXISTS messages_audio_token_idx ON messages(audio_token);
