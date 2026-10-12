-- The dashboard is public: every topic change is logged (what changed, when).
CREATE TABLE IF NOT EXISTS topic_changes (
  id         serial PRIMARY KEY,
  topic_id   int REFERENCES topics(id) ON DELETE SET NULL,
  topic_name text NOT NULL,
  action     text NOT NULL,                 -- created | edited | paused | resumed
  changes    jsonb NOT NULL DEFAULT '{}',   -- {field: {from, to}}
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS topic_changes_created_idx ON topic_changes (created_at DESC);

-- Runs started from the public buttons are counted against the daily caps.
CREATE INDEX IF NOT EXISTS runs_kind_trigger_started_idx ON runs (kind, trigger, started_at);
