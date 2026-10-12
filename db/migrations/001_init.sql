-- Research Pulse — initial schema. Applied by `npm run db:migrate`.
-- Every statement ends with ";" at the end of a line (the migrate script splits on that).

-- Kavita's topics. Seeded from context/topics.json, then edited on the dashboard.
CREATE TABLE IF NOT EXISTS topics (
  id               serial PRIMARY KEY,
  name             text NOT NULL UNIQUE,
  focus            text NOT NULL,
  arxiv_categories text[] NOT NULL DEFAULT '{}',
  search_words     text[] NOT NULL DEFAULT '{}',
  active           boolean NOT NULL DEFAULT true,
  sort_order       int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- One row per run (daily or weekly). Continuations of the same run update the same row.
CREATE TABLE IF NOT EXISTS runs (
  id              serial PRIMARY KEY,
  kind            text NOT NULL CHECK (kind IN ('daily', 'weekly')),
  trigger         text NOT NULL DEFAULT 'cron',          -- cron | admin
  status          text NOT NULL DEFAULT 'running',       -- running | done | partial | failed
  started_at      timestamptz NOT NULL DEFAULT now(),
  heartbeat_at    timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  hops            int NOT NULL DEFAULT 0,                -- how many continuations it took
  per_topic       jsonb NOT NULL DEFAULT '{}',           -- {topic_id: {arxiv_papers, tavily_results, blogs_with_paper, blogs_no_paper, relevant, not_relevant, not_assessed, pending, errors}}
  per_category    jsonb NOT NULL DEFAULT '{}',           -- {"cs.AI": {fetched, new, pages, window_start, window_end, error}}
  tavily_searches int NOT NULL DEFAULT 0,
  errors          jsonb NOT NULL DEFAULT '[]'
);

-- Where each arXiv category fetch got up to (max submitted date seen). Fetches resume from here.
CREATE TABLE IF NOT EXISTS arxiv_cursors (
  category        text PRIMARY KEY,
  watermark       timestamptz NOT NULL,
  last_fetched_at timestamptz NOT NULL DEFAULT now()
);

-- One row per paper. paper_key = "arxiv:<id>" or "doi:<doi>" (or the venue's own ID when neither exists).
CREATE TABLE IF NOT EXISTS papers (
  id                serial PRIMARY KEY,
  paper_key         text NOT NULL UNIQUE,
  arxiv_id          text UNIQUE,
  doi               text,                                 -- publisher DOI (never arXiv's own 10.48550 DOI)
  openreview_id     text,
  title             text NOT NULL,
  title_norm        text GENERATED ALWAYS AS (trim(regexp_replace(lower(title), '[^a-z0-9]+', ' ', 'g'))) STORED,
  abstract          text NOT NULL DEFAULT '',
  authors           text[] NOT NULL DEFAULT '{}',
  url               text NOT NULL,
  categories        text[] NOT NULL DEFAULT '{}',
  primary_category  text,
  published_at      timestamptz,
  journal_ref       text,
  arxiv_comment     text,
  venue             text,
  found_via         text NOT NULL,                       -- arxiv | openreview | acl | cvf | ieee | acm | blog | missed
  alt_urls          text[] NOT NULL DEFAULT '{}',
  code_url          text,
  first_seen_at     timestamptz NOT NULL DEFAULT now(),
  run_id            int REFERENCES runs(id) ON DELETE SET NULL,
  confirm_status    text NOT NULL DEFAULT 'confirmed',    -- confirmed | pending | unconfirmed
  confirm_attempts  int NOT NULL DEFAULT 0,
  clean_status      text NOT NULL DEFAULT 'pending',      -- pending | assessed | not_assessed
  clean_attempts    int NOT NULL DEFAULT 0,
  one_line          text,
  pub_status        text NOT NULL DEFAULT 'preprint' CHECK (pub_status IN ('preprint', 'peer_reviewed')),
  is_research_paper boolean NOT NULL DEFAULT true
);
CREATE INDEX IF NOT EXISTS papers_first_seen_idx ON papers (first_seen_at);
CREATE INDEX IF NOT EXISTS papers_doi_idx ON papers (doi) WHERE doi IS NOT NULL;
CREATE INDEX IF NOT EXISTS papers_title_norm_idx ON papers (title_norm);
CREATE INDEX IF NOT EXISTS papers_clean_idx ON papers (clean_status) WHERE clean_status <> 'assessed';
CREATE INDEX IF NOT EXISTS papers_confirm_idx ON papers (confirm_status) WHERE confirm_status = 'pending';

-- Question 1 per (paper, topic). A paper can belong to several topics.
CREATE TABLE IF NOT EXISTS paper_topics (
  paper_id   int NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  topic_id   int NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  status     text NOT NULL DEFAULT 'pending',             -- pending | assessed | not_assessed
  relevant   boolean,
  reason     text,
  attempts   int NOT NULL DEFAULT 0,
  via        text NOT NULL DEFAULT 'category',            -- category | tavily | blog | missed
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  PRIMARY KEY (paper_id, topic_id)
);
CREATE INDEX IF NOT EXISTS paper_topics_status_idx ON paper_topics (status) WHERE status <> 'assessed';
CREATE INDEX IF NOT EXISTS paper_topics_topic_idx ON paper_topics (topic_id, relevant);

-- Every blog found, with or without a paper behind it.
CREATE TABLE IF NOT EXISTS blogs (
  id              serial PRIMARY KEY,
  url             text NOT NULL UNIQUE,
  title           text NOT NULL,
  snippet         text NOT NULL DEFAULT '',
  published_date  text,
  topic_id        int REFERENCES topics(id) ON DELETE SET NULL,
  run_id          int REFERENCES runs(id) ON DELETE SET NULL,
  found_at        timestamptz NOT NULL DEFAULT now(),
  candidate_links text[] NOT NULL DEFAULT '{}',           -- paper links found in the blog's text
  linked_paper_id int REFERENCES papers(id) ON DELETE SET NULL,
  link_found      text,
  evidence_status text NOT NULL DEFAULT 'pending',        -- pending | paper_confirmed | no_paper | link_not_confirmed | not_assessed
  reason          text,
  attempts        int NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS blogs_found_idx ON blogs (found_at);
CREATE INDEX IF NOT EXISTS blogs_paper_idx ON blogs (linked_paper_id);

-- One row per brief.
CREATE TABLE IF NOT EXISTS briefs (
  id              serial PRIMARY KEY,
  run_id          int REFERENCES runs(id) ON DELETE SET NULL,
  week_start      timestamptz NOT NULL,
  week_end        timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'collecting',    -- collecting | scoring | ranking | writing | sending | done | failed
  created_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz,
  papers_checked  int NOT NULL DEFAULT 0,
  papers_ranked   int NOT NULL DEFAULT 0,
  per_topic       jsonb NOT NULL DEFAULT '{}',
  whats_changing  jsonb NOT NULL DEFAULT '{}',           -- {topic_id: sentence}
  written_by      text,                                  -- gemini | template
  email_subject   text,
  email_html      text,
  email_text      text,
  dashboard_json  jsonb,
  gemini_calls    int NOT NULL DEFAULT 0,
  gemini_cost_usd numeric(12, 6) NOT NULL DEFAULT 0,
  sent_at         timestamptz,
  email_status    text,
  email_id        text
);

-- Every paper considered for a brief: top 3 per topic (in_brief) and the "+ N more".
CREATE TABLE IF NOT EXISTS brief_items (
  id                    serial PRIMARY KEY,
  brief_id              int NOT NULL REFERENCES briefs(id) ON DELETE CASCADE,
  paper_id              int NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
  topic_id              int NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  relevance             text NOT NULL,                   -- yes | not_assessed
  importance_status     text NOT NULL DEFAULT 'pending', -- pending | assessed | not_assessed
  importance_attempts   int NOT NULL DEFAULT 0,
  type                  text,                            -- new_test | surprising_result | new_way_to_see_problem | nothing_new
  score                 int,
  reason_line1          text,
  reason_line2          text,
  rank                  int,
  in_brief              boolean NOT NULL DEFAULT false,
  citations             int,
  influential_citations int,
  s2_venue              text,
  author_info           text,
  s2_status             text NOT NULL DEFAULT 'pending', -- pending | ok | not_found | not_available
  hf_upvotes            int,
  hf_status             text NOT NULL DEFAULT 'pending', -- pending | ok | not_listed | not_available
  code_url              text,
  blog_count            int NOT NULL DEFAULT 0,
  UNIQUE (brief_id, paper_id, topic_id)
);
CREATE INDEX IF NOT EXISTS brief_items_brief_idx ON brief_items (brief_id, topic_id);

-- Kavita's marks. read_fully / share / not_useful are toggles per paper; missed = "You missed this".
CREATE TABLE IF NOT EXISTS marks (
  id            serial PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('read_fully', 'share', 'not_useful', 'missed')),
  paper_id      int REFERENCES papers(id) ON DELETE CASCADE,
  brief_item_id int REFERENCES brief_items(id) ON DELETE SET NULL,
  topic_id      int REFERENCES topics(id) ON DELETE SET NULL,
  missed_url    text,
  note          text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS marks_paper_kind_uq ON marks (paper_id, kind) WHERE kind <> 'missed';

-- Every Gemini call.
CREATE TABLE IF NOT EXISTS ai_usage (
  id            serial PRIMARY KEY,
  run_id        int REFERENCES runs(id) ON DELETE SET NULL,
  brief_id      int REFERENCES briefs(id) ON DELETE SET NULL,
  step          text NOT NULL,                           -- clean | evidence | qualify | importance | rank | write
  model         text NOT NULL,
  input_tokens  int NOT NULL DEFAULT 0,
  output_tokens int NOT NULL DEFAULT 0,
  cost_usd      numeric(12, 6) NOT NULL DEFAULT 0,
  items         int NOT NULL DEFAULT 0,                  -- papers / blogs in the batch
  ok            boolean NOT NULL,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_created_idx ON ai_usage (created_at);

-- Stops a cron run and an admin click from processing the same batch twice.
CREATE TABLE IF NOT EXISTS locks (
  name       text PRIMARY KEY,
  holder     text NOT NULL,
  expires_at timestamptz NOT NULL
);
