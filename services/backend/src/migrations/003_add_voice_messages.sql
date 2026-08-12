-- Voice messages: audio lives in Postgres alongside the message row so the
-- service stays self-contained (no object storage dependency). Clips are
-- capped in the API layer, so rows stay small.
ALTER TABLE messages ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio BYTEA;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS audio_mime TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration_ms INTEGER;

-- A voice row must carry audio; a text row must not claim to be voice.
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_voice_has_audio;
ALTER TABLE messages
  ADD CONSTRAINT messages_voice_has_audio
  CHECK (kind <> 'voice' OR audio IS NOT NULL);
