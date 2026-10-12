-- Older papers that reach a brief through a blog or research-site search ("Older paper (YEAR) —
-- discussed this week"): kept and shown, never counted as new, ranked below new papers in their topic.
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS older boolean NOT NULL DEFAULT false;
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS published_year int;
