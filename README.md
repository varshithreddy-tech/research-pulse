# Research Pulse

A weekly AI/ML research brief for Kavita, a senior technology-advisory consultant. It goes out every Monday morning, covers the top 3 papers per topic and reads in under 10 minutes.

**Main rule: the system decides what Kavita sees first, never what she never sees.**

| Piece | Used for |
|---|---|
| arXiv API | the complete list of new papers, fetched **by category only** |
| Tavily | research sites (OpenReview, ACL, CVF, IEEE, ACM) and blog posts |
| Semantic Scholar / Hugging Face | reaction numbers: citations, venue, authors, upvotes, code |
| **Gemini Flash** (`GEMINI_MODEL`) | all judging, sorting and writing |
| **Neon** (serverless Postgres) | all saving: the system's memory |
| Resend | the Monday email, to Kavita only |
| **Vercel** | hosting only: the website and two cron jobs |

## How it works (follows the Components Map)

**Daily, 6:00 AM IST** (`/api/daily`)

1. Reads the active topics from Neon.
2. arXiv: fetches each category **once per run**, newest first, one request every ~3 s, from where the last fetch got to (minus a 1-day overlap, because arXiv announces papers a day or more after submission). Every paper is fanned out to every topic that lists its category. Search words are **never** used to filter arXiv.
3. Tavily: two basic searches per topic with `time_range: week`: (a) research sites only, (b) blog posts with page text.
4. **Clean record**: code removes repeats (same arXiv ID, DOI or title means one record, and Neon enforces a unique `paper_key`). Gemini writes a one-line summary and sets Preprint / Peer-reviewed from the facts given.
5. **Evidence check**: code finds paper links in each blog and confirms each paper exists on arXiv or Semantic Scholar. Gemini then decides which confirmed paper the blog is actually about. That paper becomes the item, and the blog shows under it as "Discussed in". Blogs with no paper are saved and counted.
6. **Qualifying check (Question 1)**: Gemini judges every fetched paper against each candidate topic's plain-English focus. Each answer is Yes or No plus one line.
7. Saves a run row with counts per topic and per arXiv category.

**Monday, 6:30 AM IST** (`/api/weekly`)

1. Finishes any checks still waiting, then pulls the week's relevant papers.
2. Gets reaction numbers: Semantic Scholar (citations, influential citations, venue, authors' past work), Hugging Face (upvotes, code link) and the blog count. A source that fails shows "not available".
3. **Question 2**: Gemini follows `importance.md`, with Kavita's past marks as context.
4. **Rank**: Gemini orders each topic's best-scored papers (Question 2 runs once per paper and is reused across topics). Up to 3 papers scoring 5 or more per topic are shown in full, and every other paper stays one click away as "+ N more papers checked". **Each paper is shown in full only once per brief**: in later topics it becomes one line, "Also relevant here: <title> (see <topic>)", and the slot goes to that topic's next-best paper. Older papers (published before the week, found via blogs or research sites) are labelled and always rank below new ones.
5. **Write**: one Gemini call writes a "What's changing" sentence per topic (max 25 words) and "What it's about" (2–3 plain-English sentences) for the papers shown in full only. Code fills in titles, links, facts and counts exactly as stored, and renders the email and the dashboard version. Each paper card: title · facts line · What it's about · Why it may matter · Read fully / Share with a client / Not useful.
6. Saves the brief: papers ranked, papers checked, and the Gemini cost of the week.
7. Resend emails the brief to `KAVITA_EMAIL`.

If a Gemini call fails, the paper is kept, marked **"not assessed"** and still counted. If ranking fails, papers are sorted by score. If writing fails, a plain template is used and the email still goes out.

**Long runs.** Vercel stops a function after 300 s. Each invocation works for about 250 s, saves its progress (anything unfinished stays `pending` in Neon) and then calls its own route to continue the same run. Up to 12 continuations are allowed per run.

## Rules built into the code

- **Rank, never hide.** Every paper checked is on *All papers*: off-topic ones (with the reason), papers not assessed, papers waiting for a check, and links that could not be confirmed. A topic with 0 papers is always named.
- **Facts, not labels.** Pages show "Cited 12 times (3 influential)", "40 upvotes on Hugging Face", "Code shared", "Preprint" or "Peer-reviewed (venue)". The words "validated" and "breakthrough" are stripped from anything Gemini writes.
- **Blogs are leads, papers are evidence.** See `context/evidence-rules.md`.
- **Nothing goes to clients.** The only email address the system ever sends to is `KAVITA_EMAIL`. The client shortlist is a page for Kavita, not a mailing list.

## One-click feedback from the email

Each paper in the email has **Read fully · Share with a client · Not useful** links. A link carries a token signed with `CRON_SECRET` (HMAC-SHA256) that names one brief item and one mark type, and expires after 14 days, so no login is needed and it can't be changed into a different mark. Opening the link shows a page that saves the mark itself (a mail filter that only fetches the URL records nothing). Clicking twice doesn't create a duplicate. The email ends with a "You missed this?" link to the dashboard form.

## Context files (Gemini reads these before every judgment)

`context/importance.md`, `context/evidence-rules.md` and `context/brief-format.md`, plus Kavita's live topic list from Neon. `context/topics.json` only seeds that list. After seeding, Kavita edits topics on the **Topics** page.

## Setup

```bash
npm install
```

```bash
npm run db:migrate
```

```bash
npm run db:seed
```

```bash
npm test
```

```bash
npm run dev
```

Before running these, fill in `.env.local` (it is git-ignored). `db:migrate` applies `db/migrations/*.sql` to Neon, and `db:seed` loads `context/topics.json` (existing topics are never overwritten).

| Variable | |
|---|---|
| `GEMINI_API_KEY`, `GEMINI_MODEL` | e.g. a Gemini Flash model id |
| `GEMINI_PRICE_INPUT_PER_M`, `GEMINI_PRICE_OUTPUT_PER_M` | USD per 1M tokens, used for the cost columns |
| `TAVILY_API_KEY` | optional for a first test; the run carries on without it |
| `DATABASE_URL` | Neon **pooled** connection string |
| `RESEND_API_KEY`, `KAVITA_EMAIL` | sender is `onboarding@resend.dev`, so `KAVITA_EMAIL` must be the Resend account's own email until a domain is verified |
| `CRON_SECRET` | protects `/api/daily`, `/api/weekly`, `/api/admin/*`; Vercel Cron sends it automatically |
| `DASHBOARD_PASSWORD` | **required**: protects the dashboard. The app refuses to build or start if this or `CRON_SECRET` is empty, so it can never be deployed open |
| `SEMANTIC_SCHOLAR_API_KEY` | optional; raises the rate limit |
| `GEMINI_CONCURRENCY` | optional, default 3 parallel Gemini calls (use 1–2 on the free tier) |
| `ARXIV_BACKFILL_DAYS` | optional, default 2: how far back the very first fetch of a category goes |
| `APP_URL` | optional; dashboard URL for email links (defaults to the Vercel production URL) |

## Deploy on Vercel

1. Push this repo to GitHub and import it in Vercel. The framework is detected as Next.js.
2. Add every variable above in **Project → Settings → Environment Variables** (Production).
3. Deploy. `vercel.json` registers both crons and pins the functions to `sin1`, next to the Neon database in Singapore.
4. Open the site, log in with `DASHBOARD_PASSWORD`, and press **Run daily now**, then **Make brief now**, to see live data straight away.

Rebuild only the text of an existing brief (one Gemini call, no email): `npm run brief:rebuild -- <briefId>`.

Script triggers:

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/admin/run-daily
```

```bash
curl -X POST -H "Authorization: Bearer $CRON_SECRET" https://<your-app>.vercel.app/api/admin/make-brief
```

**Vercel Hobby timing.** On the Hobby plan, cron jobs run at some point within the scheduled hour. The daily run starts between 6:00 and 7:00 AM IST, and **Monday's email arrives between 6:30 and 7:30 AM IST**. The Pro plan runs on the minute.

## Dashboard

| Page | What Kavita does there |
|---|---|
| This week's brief | Reads the top 3 per topic. Each paper has **Read fully · Share with a client · Not useful** buttons. There's a **You missed this** form, an archive of past briefs and the admin buttons |
| All papers | Sees every paper checked, filtered by week and topic, including the "+ N more", off-topic and not-assessed papers, and blogs with no paper |
| Topics | Adds, edits or pauses topics without code |
| Client shortlist | Sees only papers she marked "Share with a client" |
| Cost & coverage | Per week: papers checked per topic and per arXiv category, blogs checked and blogs with no paper, Gemini calls and cost, Tavily searches used (of 1,000 a month), briefs sent, papers shared, "You missed this" count, and recent runs with their errors |

## Notes and limits

- **OpenReview.** OpenReview's API now requires a browser challenge, so the system doesn't call it. OpenReview papers found by Tavily are confirmed through Semantic Scholar, which also gives the venue that decides Preprint or Peer-reviewed.
- **Gemini volume.** Fetching by category means every new paper in those categories gets a relevance check, roughly 1,000–1,500 papers a day across the default topics. That's the price of not missing papers that don't use Kavita's words. Batches of 20–25 papers per call keep it to about 100 calls a day. The actual cost is on the Cost & coverage page.
- **Neon free plan** gives 0.5–1 GB of storage, which holds several months of papers. Old abstracts can be pruned later without losing any brief.
