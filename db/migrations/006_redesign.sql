-- Redesign: tiers, client angle, lab, weekly summary, themes, shortlist tags. Additive only — the
-- previous version of the app keeps working against this schema.

-- Tier (1 Bring to a client · 2 Read this week · 3 Just so you know), set in code for picked papers.
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS tier smallint;
-- Client angle (write step): who it matters to, how strong the evidence is, a sentence for a meeting.
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS audience text;
-- evidence: 1 Lab result · 2 Benchmark · 3 Real deployment
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS evidence smallint;
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS say text;
-- Authors' institutions from Semantic Scholar (never invented; NULL when Semantic Scholar has none).
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS affiliation text;

-- The week in a few plain lines, and 2–3 theme tags per topic (write step).
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS summary jsonb;
ALTER TABLE briefs ADD COLUMN IF NOT EXISTS themes jsonb;

-- Client / mandate tags on shortlisted papers (free text, reusable).
CREATE TABLE IF NOT EXISTS shortlist_tags (
  paper_id   int NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  tag        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (paper_id, tag)
);
CREATE INDEX IF NOT EXISTS shortlist_tags_tag_idx ON shortlist_tags (lower(tag));
