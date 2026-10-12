# brief-format.md — The Monday brief

Kavita must be able to read it in **under 10 minutes**. Short sentences, plain English, no hype.

## Top line (facts, written by code)

- Week dates (e.g. "6–12 Oct 2026").
- New papers checked: total, and per topic.
- Older papers discussed this week (published before the week, found via blogs / research sites) — counted separately, never as new.
- Blogs checked / blogs with no paper.
- Any topic with 0 papers — always named, never left out.
- Papers still waiting for a check or not assessed, if any.

## Then, for each topic (in Kavita's topic order)

1. **What's changing** — ONE plain-English sentence, **at most 25 words**, on the direction this week's papers point to in this topic. No jargon, no acronyms, no hype words, no numbers. Base it only on the papers given. If the week is quiet, say so plainly.
2. **Up to 3 papers shown in full**, highest rank first. **Each paper is shown in full only once per brief** — in the first topic (in topic order) where it is in the top 3. In any later topic it gets one line, **"Also relevant here: <title> (see <topic>)"**, and its slot goes to that topic's next-best paper not yet shown. Each paper card, in this order:
   - **Title** (linked). Older papers also carry "Older paper (YEAR) — discussed this week".
   - **Facts line:** type · score · Preprint / Peer-reviewed · citations · upvotes · code shared · "Discussed in" if any — "not available" when a source failed.
   - **What it's about:** 2–3 short sentences — the problem, what they did, what they found.
   - **Why it may matter:** ONE sentence from a company's point of view — what decision, cost or risk it touches.

   **Writing rule for both:** plain English for a busy business consultant, not a researcher. Sentences of about 20 words at most. No jargon — if a technical term is needed, explain it in brackets the first time, e.g. "benchmark (a standard test)". No hype words: never "critical", "groundbreaking", "breakthrough", "validated" (or "crucial", "revolutionary", "unprecedented", "state-of-the-art").
   - **Feedback:** Read fully · Share with a client · Not useful (one-click links in the email, buttons on the dashboard).
3. **"+ N more papers checked"** — link to every other paper for this topic on the dashboard.

If no paper in a topic scores 5 or more, show **"Quiet week"** instead of papers (all papers are still behind "+ N more papers checked").

## Footer

> This brief suggests. You decide what to read and what to share.

Plus a **"You missed this?"** link to the dashboard form.

## Your job (Gemini) when writing

You write only:
- the **"What's changing"** sentence per topic (max 25 words), and
- **"What it's about"** and a plain **"Why it may matter"** for the papers shown in full (and only those), following the writing rule above.

Code fills in titles, links, facts and counts exactly as stored, so you never restate numbers. Never add a result that is not in the paper's own summary. Never use "validated", "breakthrough", "groundbreaking" or "state-of-the-art". Never mention a paper that was not given to you.
