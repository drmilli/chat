-- Replies were sent by the client but never stored, so a quoted message
-- disappeared as soon as the page reloaded.
--
-- Only the parent id is kept: the author and the quoted snippet are read back
-- with a join, so they stay correct instead of drifting from the original.
-- ON DELETE SET NULL keeps a reply readable after its parent is removed.
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_id INT REFERENCES messages(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS messages_reply_to_idx ON messages(reply_to_id);
