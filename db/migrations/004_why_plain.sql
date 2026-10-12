-- "Why it may matter" in plain English, written with "What it's about" for papers shown in full.
-- (reason_line2 from Question 2 is kept unchanged on the brief item.)
ALTER TABLE brief_items ADD COLUMN IF NOT EXISTS why text;
