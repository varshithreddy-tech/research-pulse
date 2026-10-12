// DAILY RUN (6:00 AM IST). Collect → clean → evidence → qualify → save counts.
// Resumable: if 250 s isn't enough, it saves progress and chains to itself (same run row).
import { activeTopics, appendRunError, q, q1, type Topic } from "../db";
import { envNumber } from "../env";
import { findPaperLinks, classifyUrl } from "../ids";
import { addPaperTopic, saveArxivPapers, savePlaceholderPaper } from "../papers";
import { fetchCategory } from "../sources/arxiv";
import { searchBlogs, searchResearchSites, tavilyConfigured } from "../sources/tavily";
import {
  BUDGET_MS, MAX_HOPS, chainNext, finishRun, heartbeat, lockOrWait, nothingPending, pendingCounts, processQueue, unlock,
} from "./common";

const OVERLAP_MS = 24 * 3600_000; // re-check the last day: arXiv announces papers a day or more after submission

interface CategoryState {
  done?: boolean;
  fetched?: number;
  new?: number;
  pages?: number;
  window_start?: string;
  window_end?: string;
  error?: string;
}

async function runState(runId: number) {
  return (await q1<{ per_category: Record<string, CategoryState>; per_topic: Record<string, Record<string, unknown>> }>(
    `SELECT per_category, per_topic FROM runs WHERE id = $1`,
    [runId],
  ))!;
}

async function setCategory(runId: number, cat: string, state: CategoryState): Promise<void> {
  await q(`UPDATE runs SET per_category = per_category || jsonb_build_object($2::text, $3::jsonb), heartbeat_at = now() WHERE id = $1`, [
    runId,
    cat,
    JSON.stringify(state),
  ]);
}

async function mergeTopicState(runId: number, topicId: number, patch: Record<string, unknown>): Promise<void> {
  await q(
    `UPDATE runs SET per_topic = jsonb_set(per_topic, ARRAY[$2::text], COALESCE(per_topic -> $2::text, '{}'::jsonb) || $3::jsonb),
       heartbeat_at = now() WHERE id = $1`,
    [runId, String(topicId), JSON.stringify(patch)],
  );
}

/** Daily 2 — arXiv, each category once per run, papers fanned out to every topic listing that category. */
async function collectArxiv(runId: number, topics: Topic[], deadline: number): Promise<boolean> {
  const cats = [...new Set(topics.flatMap((t) => t.arxiv_categories))].sort();
  const state = (await runState(runId)).per_category;
  const backfillMs = envNumber("ARXIV_BACKFILL_DAYS", 2) * 86_400_000;
  for (const cat of cats) {
    if (state[cat]?.done) continue;
    if (Date.now() > deadline - 30_000) return false;
    const cursor = await q1<{ watermark: string }>(`SELECT watermark FROM arxiv_cursors WHERE category = $1`, [cat]);
    const to = new Date();
    const from = cursor ? new Date(new Date(cursor.watermark).getTime() - OVERLAP_MS) : new Date(to.getTime() - backfillMs);
    let newCount = 0;
    let maxSeen = cursor ? new Date(cursor.watermark).getTime() : 0;
    try {
      const r = await fetchCategory(cat, from, to, deadline - 30_000, async (papers) => {
        newCount += (await saveArxivPapers(papers, runId)).length;
        for (const p of papers) maxSeen = Math.max(maxSeen, new Date(p.published_at).getTime() || 0);
      });
      if (!r.complete) return false; // out of time mid-category: next hop redoes it (repeats are skipped)
      if (maxSeen > 0)
        await q(
          `INSERT INTO arxiv_cursors (category, watermark) VALUES ($1, $2)
           ON CONFLICT (category) DO UPDATE SET watermark = GREATEST(arxiv_cursors.watermark, EXCLUDED.watermark), last_fetched_at = now()`,
          [cat, new Date(maxSeen).toISOString()],
        );
      await setCategory(runId, cat, {
        done: true, fetched: r.fetched, new: newCount, pages: r.pages, window_start: from.toISOString(), window_end: to.toISOString(),
      });
    } catch (e) {
      // Cursor not moved, so tomorrow's run covers this window again. The error is shown on the dashboard.
      await setCategory(runId, cat, { done: true, error: String(e).slice(0, 300), new: newCount, window_start: from.toISOString(), window_end: to.toISOString() });
      await appendRunError(runId, `arxiv ${cat}`, String(e));
    }
  }
  return true;
}

function siteOf(url: string): string {
  if (url.includes("openreview.net")) return "openreview";
  if (url.includes("aclanthology.org")) return "acl";
  if (url.includes("thecvf.com")) return "cvf";
  if (url.includes("ieeexplore.ieee.org")) return "ieee";
  if (url.includes("dl.acm.org")) return "acm";
  return "web";
}

/** Daily 2 — Tavily, two basic searches per topic. If Tavily fails, the run carries on without it. */
async function collectTavily(runId: number, topics: Topic[], deadline: number): Promise<boolean> {
  if (!tavilyConfigured()) {
    for (const t of topics) await mergeTopicState(runId, t.id, { tavily_done: true, tavily_note: "Tavily not configured" });
    return true;
  }
  const state = (await runState(runId)).per_topic;
  for (const t of topics) {
    if (state[String(t.id)]?.tavily_done) continue;
    if (Date.now() > deadline - 40_000) return false;
    const errors: string[] = [];
    let searches = 0;
    let researchResults = 0;
    let researchPapers = 0;
    let nonPaperPages = 0;
    let blogsFound = 0;
    let blogsNew = 0;

    try {
      const results = await searchResearchSites(t.name, t.search_words);
      searches++;
      researchResults = results.length;
      for (const r of results) {
        const link = classifyUrl(r.url);
        if (!link) {
          nonPaperPages++;
          continue;
        }
        const { id } = await savePlaceholderPaper(link, r.title, r.content ?? "", siteOf(r.url), runId);
        await addPaperTopic(id, t.id, "tavily");
        researchPapers++;
      }
    } catch (e) {
      errors.push(`research sites: ${String(e).slice(0, 200)}`);
    }

    try {
      const results = await searchBlogs(t.name, t.search_words);
      searches++;
      blogsFound = results.length;
      for (const r of results) {
        const text = `${r.raw_content ?? ""}\n${r.content ?? ""}`;
        const links = findPaperLinks(text).map((l) => l.url);
        const snippet = `${r.content ?? ""}\n\n${(r.raw_content ?? "").slice(0, 1500)}`.trim();
        const ins = await q(
          `INSERT INTO blogs (url, title, snippet, published_date, topic_id, run_id, candidate_links)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (url) DO NOTHING RETURNING id`,
          [r.url, r.title || r.url, snippet, r.published_date ?? null, t.id, runId, links],
        );
        blogsNew += ins.length;
      }
    } catch (e) {
      errors.push(`blogs: ${String(e).slice(0, 200)}`);
    }

    await q(`UPDATE runs SET tavily_searches = tavily_searches + $2 WHERE id = $1`, [runId, searches]);
    await mergeTopicState(runId, t.id, {
      tavily_done: true,
      tavily_results: researchResults + blogsFound,
      research_results: researchResults,
      research_papers: researchPapers,
      research_non_paper_pages: nonPaperPages,
      blogs_found: blogsFound,
      blogs_new: blogsNew,
      tavily_errors: errors,
    });
    for (const e of errors) await appendRunError(runId, `tavily ${t.name}`, e);
  }
  return true;
}

/** Daily 7 — per-topic counts for this run's papers and blogs, written to the run row. */
export async function saveRunCounts(runId: number): Promise<void> {
  const papers = await q<Record<string, number>>(
    `SELECT pt.topic_id,
       count(*) FILTER (WHERE p.found_via = 'arxiv')::int AS arxiv_papers,
       count(*) FILTER (WHERE p.found_via <> 'arxiv')::int AS other_papers,
       count(*) FILTER (WHERE pt.status = 'assessed' AND pt.relevant)::int AS relevant,
       count(*) FILTER (WHERE pt.status = 'assessed' AND NOT pt.relevant)::int AS not_relevant,
       count(*) FILTER (WHERE pt.status = 'not_assessed')::int AS not_assessed,
       count(*) FILTER (WHERE pt.status = 'pending')::int AS pending
     FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
     WHERE p.run_id = $1 GROUP BY pt.topic_id`,
    [runId],
  );
  const blogs = await q<Record<string, number>>(
    `SELECT topic_id,
       count(*) FILTER (WHERE evidence_status = 'paper_confirmed')::int AS blogs_with_paper,
       count(*) FILTER (WHERE evidence_status IN ('no_paper', 'link_not_confirmed'))::int AS blogs_no_paper,
       count(*) FILTER (WHERE evidence_status IN ('pending', 'not_assessed'))::int AS blogs_unchecked
     FROM blogs WHERE run_id = $1 AND topic_id IS NOT NULL GROUP BY topic_id`,
    [runId],
  );
  const topics = await q<{ id: number }>(`SELECT id FROM topics WHERE active`);
  for (const t of topics) {
    const p = papers.find((r) => r.topic_id === t.id) ?? {};
    const b = blogs.find((r) => r.topic_id === t.id) ?? {};
    await mergeTopicState(runId, t.id, {
      arxiv_papers: p.arxiv_papers ?? 0,
      other_papers: p.other_papers ?? 0,
      relevant: p.relevant ?? 0,
      not_relevant: p.not_relevant ?? 0,
      not_assessed: p.not_assessed ?? 0,
      pending: p.pending ?? 0,
      blogs_with_paper: b.blogs_with_paper ?? 0,
      blogs_no_paper: b.blogs_no_paper ?? 0,
      blogs_unchecked: b.blogs_unchecked ?? 0,
    });
  }
}

/** One invocation of the daily run. Called in the background (after the HTTP response). */
export async function dailyInvocation(runId: number, hop: number, origin: string): Promise<void> {
  const started = Date.now();
  const holder = `daily:${runId}:${hop}`;
  if (!(await lockOrWait(holder, 90_000))) {
    // Another run is busy. Try again in a fresh invocation rather than racing it.
    if (hop < MAX_HOPS && (await chainNext(origin, "/api/daily", { run: runId, hop: hop + 1 }))) return;
    await appendRunError(runId, "lock", "Another run was busy; this run will be picked up by the next one.");
    await finishRun(runId, "partial");
    return;
  }
  let chained = false;
  try {
    await heartbeat(runId, hop);
    const deadline = started + BUDGET_MS;
    const topics = await activeTopics();
    const arxivDone = await collectArxiv(runId, topics, deadline);
    const tavilyDone = arxivDone && (await collectTavily(runId, topics, deadline));
    const before = await pendingCounts();
    const left = await processQueue(topics, { runId }, deadline);
    await saveRunCounts(runId);
    // A hop that moved nothing (e.g. only papers waiting on a rate-limited Semantic Scholar) stops
    // chaining: those papers stay "pending", are shown and counted, and the next run retries them.
    const stuck = arxivDone && tavilyDone && !nothingPending(left) && JSON.stringify(before) === JSON.stringify(left);
    if (stuck)
      await appendRunError(
        runId,
        "waiting",
        `${left.confirm} paper(s) still waiting to be confirmed (Semantic Scholar busy), ${left.clean + left.qualify + left.blogs} check(s) waiting on them — the next run retries.`,
      );
    const finished = arxivDone && tavilyDone && (nothingPending(left) || stuck);
    if (!finished && hop < MAX_HOPS) {
      await unlock(holder);
      chained = await chainNext(origin, "/api/daily", { run: runId, hop: hop + 1 });
    }
    if (!chained) await finishRun(runId, finished ? "done" : "partial");
  } catch (e) {
    await appendRunError(runId, "daily", String(e));
    await finishRun(runId, "failed");
  } finally {
    if (!chained) await unlock(holder);
  }
}
