-- Run once in Supabase before deploying the rework. Existing records are kept;
-- legacy inventory keys are normalized safely by the application on next login.
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_luck NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS dice_count INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN IF NOT EXISTS game_settings JSONB NOT NULL DEFAULT '{"rollingAnimation":true,"fullDiscovery":true}'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS active_session_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mutation_version BIGINT NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_mutation_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_mutation_response JSONB;

CREATE TABLE IF NOT EXISTS game_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  created_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS game_sessions_user_id_idx ON game_sessions(user_id);
CREATE INDEX IF NOT EXISTS game_sessions_expires_at_idx ON game_sessions(expires_at);

CREATE TABLE IF NOT EXISTS trade_rooms (
  id TEXT PRIMARY KEY,
  inviter_id TEXT NOT NULL,
  members JSONB NOT NULL,
  status TEXT NOT NULL,
  offers JSONB NOT NULL DEFAULT '{}'::jsonb,
  confirmed JSONB NOT NULL DEFAULT '[]'::jsonb,
  expires_at BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS trade_rooms_expires_at_idx ON trade_rooms(expires_at);
