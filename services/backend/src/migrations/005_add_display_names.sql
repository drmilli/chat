-- Chat identities had no human-readable name: messages were labelled with the
-- raw identity id (a wallet address, or the shared literal "anonymous").
ALTER TABLE identities
  ADD COLUMN IF NOT EXISTS display_name TEXT;

-- Names are shown next to messages, so keep them short and non-empty.
ALTER TABLE identities
  DROP CONSTRAINT IF EXISTS identities_display_name_length;

ALTER TABLE identities
  ADD CONSTRAINT identities_display_name_length
  CHECK (display_name IS NULL OR char_length(btrim(display_name)) BETWEEN 1 AND 32);
