// Monday 4 — Rank, never hide. Gemini orders each topic's best-scored papers using the score and
// the reaction numbers; code then gives EVERY item a rank. Up to 3 papers scoring 5+ per topic are
// shown in full; all others stay one click away as "+ N more papers checked". If Gemini fails, code
// sorts by score. A paper is shown in full only once per brief (first topic, in topic order); later
// topics show it as one line "Also relevant here" and give the slot to their next-best new paper.
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, isObj, S, type UsageCtx } from "../gemini";
import type { Topic } from "../db";

export interface RankRow {
  id: number;
  paper_id: number;
  topic_id: number;
  title: string;
  importance_status: string;
  relevance: string;
  type: string | null;
  score: number | null;
  reason_line1: string | null;
  citations: number | null;
  hf_upvotes: number | null;
  blog_count: number;
  code: boolean;
  pub_status: string;
  older: boolean;
}

export const MIN_BRIEF_SCORE = 5;
const GEMINI_CANDIDATES = 15;

/** Fallback / tie-break order: score, then attention signals. */
export function fallbackOrder(a: RankRow, b: RankRow): number {
  return (
    (b.score ?? -1) - (a.score ?? -1) ||
    (b.citations ?? 0) - (a.citations ?? 0) ||
    (b.hf_upvotes ?? 0) - (a.hf_upvotes ?? 0) ||
    b.blog_count - a.blog_count ||
    a.id - b.id
  );
}

/** Final order for one topic: Gemini's order for the candidates it saw, then everyone else. */
export function finalOrder(rows: RankRow[], geminiOrder: number[] | null): RankRow[] {
  const scored = rows.filter((r) => r.importance_status === "assessed").sort(fallbackOrder);
  const candidates = scored.slice(0, GEMINI_CANDIDATES);
  const byId = new Map(candidates.map((r) => [r.id, r]));
  const ordered: RankRow[] = [];
  for (const id of geminiOrder ?? []) {
    const r = byId.get(id);
    if (r && !ordered.includes(r)) ordered.push(r);
  }
  for (const r of candidates) if (!ordered.includes(r)) ordered.push(r);
  const rest = scored.slice(GEMINI_CANDIDATES);
  const notScored = rows.filter((r) => r.importance_status !== "assessed").sort((a, b) => a.id - b.id);
  const all = [...ordered, ...rest, ...notScored];
  // Older papers (discussed this week, published before it) always rank below every new paper.
  return [...all.filter((r) => !r.older), ...all.filter((r) => r.older)];
}

const eligible = (r: RankRow) => r.importance_status === "assessed" && (r.score ?? 0) >= MIN_BRIEF_SCORE;

export interface Selection {
  full: Set<number>; // brief_item ids shown in full
  also: Map<number, number>; // brief_item id → topic id where that paper is shown in full
}

/**
 * Which papers each topic shows, across the whole brief. `perTopic` must be in topic order, each
 * list in final rank order. A topic's "top 3" are its first 3 eligible papers (score 5+); any of
 * those already shown in an earlier topic becomes an "Also relevant here" line, and the free slots
 * go to the topic's next-best papers not yet shown — so each topic still shows up to 3 full papers.
 */
export function selectBrief(perTopic: { topicId: number; ordered: RankRow[] }[]): Selection {
  const full = new Set<number>();
  const also = new Map<number, number>();
  const shownIn = new Map<number, number>(); // paper_id → topic id
  for (const { topicId, ordered } of perTopic) {
    const candidates = ordered.filter(eligible);
    for (const r of candidates.slice(0, 3)) {
      const where = shownIn.get(r.paper_id);
      if (where !== undefined) also.set(r.id, where);
    }
    let slots = 0;
    for (const r of candidates) {
      if (slots === 3) break;
      if (shownIn.has(r.paper_id)) continue;
      full.add(r.id);
      shownIn.set(r.paper_id, topicId);
      slots++;
    }
  }
  return { full, also };
}

/** Writes ranks + selection for the whole brief. */
async function saveSelection(perTopic: { topicId: number; ordered: RankRow[] }[]): Promise<void> {
  const sel = selectBrief(perTopic);
  const updates = perTopic.flatMap(({ ordered }) =>
    ordered.map((r, i) => ({ id: r.id, rank: i + 1, in_brief: sel.full.has(r.id), also: sel.also.get(r.id) ?? null })),
  );
  await q(
    `UPDATE brief_items bi SET rank = v.rank, in_brief = v.in_brief, also_shown_in = v.also
     FROM jsonb_to_recordset($1::jsonb) AS v(id int, rank int, in_brief boolean, also int) WHERE bi.id = v.id`,
    [JSON.stringify(updates)],
  );
}

const RANK_ROWS_SQL = `SELECT bi.id, bi.paper_id, bi.topic_id, p.title, bi.importance_status, bi.relevance, bi.type, bi.score,
       bi.reason_line1, bi.citations, bi.hf_upvotes, bi.blog_count, (COALESCE(bi.code_url, p.code_url) IS NOT NULL) AS code,
       p.pub_status, bi.older, bi.rank
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id WHERE bi.brief_id = $1`;

/** Re-applies the selection from ranks already stored (no Gemini) — used to rebuild a brief's text. */
export async function reselectFromStoredRanks(briefId: number, topics: Topic[]): Promise<void> {
  const rows = await q<RankRow & { rank: number | null }>(RANK_ROWS_SQL, [briefId]);
  const perTopic = topics.map((t) => ({
    topicId: t.id,
    ordered: rows.filter((r) => r.topic_id === t.id).sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.id - b.id),
  }));
  await saveSelection(perTopic);
}

const INSTRUCTIONS = `STEP: RANK papers within ONE topic for Kavita's brief.
Order them from most to least worth her attention, using the score (from importance.md) first and the facts
(citations, upvotes, blogs, code, peer review) as supporting signals. Facts show attention, not quality.
Return {"order": [iid, iid, ...]} containing every iid given, exactly once.`;

const SCHEMA = S.obj({ order: S.arr(S.int()) });

export async function rankBrief(briefId: number, topics: Topic[], ctx: UsageCtx): Promise<number> {
  const rows = await q<RankRow>(RANK_ROWS_SQL, [briefId]);
  const perTopic: { topicId: number; ordered: RankRow[] }[] = [];
  for (const topic of topics) {
    const mine = rows.filter((r) => r.topic_id === topic.id);
    if (!mine.length) continue;
    const candidates = mine.filter((r) => r.importance_status === "assessed").sort(fallbackOrder).slice(0, GEMINI_CANDIDATES);
    let order: number[] | null = null;
    if (candidates.length >= 2) {
      const res = await geminiJson({
        step: "rank",
        system: systemPrompt(topics, INSTRUCTIONS),
        user: JSON.stringify({
          topic: topic.name,
          papers: candidates.map((r) => ({
            iid: r.id,
            title: r.title,
            type: r.type,
            score: r.score,
            claim: r.reason_line1,
            facts: { citations: r.citations, hf_upvotes: r.hf_upvotes, blogs: r.blog_count, code_shared: r.code, status: r.pub_status },
          })),
        }),
        schema: SCHEMA,
        items: candidates.length,
        ctx,
        validate: (o) => (isObj(o) && Array.isArray(o.order) ? (o.order as unknown[]).map(Number) : null),
      });
      order = res.ok ? res.data : null;
    }
    perTopic.push({ topicId: topic.id, ordered: finalOrder(mine, order) });
  }
  await saveSelection(perTopic);
  return rows.filter((r) => r.importance_status === "assessed").length;
}
