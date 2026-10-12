-- Each paper is shown in full once per brief; in later topics it gets one line "Also relevant here".
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS also_shown_in int REFERENCES topics(id) ON DELETE SET NULL;
-- "What it's about": 2–3 plain-English sentences, written only for papers shown in full.
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS about text;
