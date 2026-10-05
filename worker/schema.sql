CREATE TABLE IF NOT EXISTS snapshots (
  source_key TEXT PRIMARY KEY,
  payload TEXT NOT NULL DEFAULT '{}',
  revision TEXT NOT NULL DEFAULT '',
  checked_at INTEGER NOT NULL DEFAULT 0,
  attempted_at INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  source_key TEXT,
  category TEXT NOT NULL,
  payload TEXT NOT NULL,
  deliver_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  next_attempt INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_due ON messages(sent_at, deliver_at, next_attempt, lease_until);
CREATE INDEX IF NOT EXISTS messages_source ON messages(source_key, category);
CREATE INDEX IF NOT EXISTS messages_expiry ON messages(expires_at);
