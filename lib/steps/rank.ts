// Monday 4 — Rank, never hide. Gemini orders each topic's best-scored papers using the score and
// the reaction numbers; code then gives EVERY item a rank, picks ~18 papers across topics (each paper
// once) and sets their tiers. Everything else stays one click away as "+ N more". If Gemini fails,
// code sorts by score.
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

/** Only new papers scoring 5+ can be picked; older papers stay in All papers, labelled. */
const eligible = (r: RankRow) => r.importance_status === "assessed" && (r.score ?? 0) >= MIN_BRIEF_SCORE && !r.older;

export const PICK_TARGET = 18; // ~18 picked papers keeps the brief inside 10 minutes
export const PER_TOPIC_MAX = 3;
export const TIER1_MAX = 3; // "Bring to a client": at most 3 a week, across all topics
export const TIER2_MAX = 8; // "Read this week"
export type Tier = 1 | 2 | 3; // 3 = "Just so you know"
export const TIER_LABEL: Record<Tier, string> = { 1: "Bring to a client", 2: "Read this week", 3: "Just so you know" };

export interface Selection {
  full: Set<number>; // brief_item ids picked (each paper once, under its home topic)
  tier: Map<number, Tier>; // brief_item id → tier, for picked items
}

/**
 * Which papers the brief picks, and their tiers. `perTopic` must be in topic order, each list in
 * final rank order.
 * - Each paper is picked at most once, under its "home" topic: the topic where it ranks highest
 *   (ties → the earlier topic). Its other topics show "also relevant to".
 * - Picks go round the topics: every topic's best paper first, then the second-best, then the
 *   third (at most 3 per topic), stronger scores first within a round, until ~18 are picked.
 * - Tiers are forced here, never by Gemini: the 3 strongest picks across topics (at most one per
 *   topic while possible) are "Bring to a client", the next 8 "Read this week", the rest "Just so
 *   you know". The numeric score is only used for this ordering.
 */
export function selectBrief(perTopic: { topicId: number; ordered: RankRow[] }[], target = PICK_TARGET): Selection {
  // Home topic per paper: best position among its eligible rows.
  const home = new Map<number, { topicId: number; pos: number }>();
  perTopic.forEach(({ topicId, ordered }) =>
    ordered.filter(eligible).forEach((r, pos) => {
      const cur = home.get(r.paper_id);
      if (!cur || pos < cur.pos) home.set(r.paper_id, { topicId, pos });
    }),
  );
  const queues = perTopic.map(({ topicId, ordered }) => ({
    topicId,
    rows: ordered.filter((r) => eligible(r) && home.get(r.paper_id)?.topicId === topicId).slice(0, PER_TOPIC_MAX),
  }));

  const picked: { r: RankRow; pos: number; topicId: number }[] = [];
  for (let pos = 0; pos < PER_TOPIC_MAX && picked.length < target; pos++) {
    const round = queues
      .filter((qq) => qq.rows[pos])
      .map((qq) => ({ r: qq.rows[pos], pos, topicId: qq.topicId }))
      .sort((a, b) => fallbackOrder(a.r, b.r));
    for (const p of round) {
      if (picked.length >= target) break;
      picked.push(p);
    }
  }

  // Strongest first: score (then attention signals), then position within its topic.
  const strongest = [...picked].sort((a, b) => (b.r.score ?? 0) - (a.r.score ?? 0) || a.pos - b.pos || fallbackOrder(a.r, b.r));
  const tier = new Map<number, Tier>();
  const t1Topics = new Set<number>();
  for (const p of strongest) {
    if (tier.size >= TIER1_MAX) break;
    if (t1Topics.has(p.topicId)) continue;
    tier.set(p.r.id, 1);
    t1Topics.add(p.topicId);
  }
  for (const p of strongest) {
    if ([...tier.values()].filter((t) => t === 1).length >= TIER1_MAX) break;
    if (!tier.has(p.r.id)) tier.set(p.r.id, 1); // fewer topics than 3: fill from the rest
  }
  let t2 = 0;
  for (const p of strongest) {
    if (tier.has(p.r.id)) continue;
    tier.set(p.r.id, t2 < TIER2_MAX ? 2 : 3);
    t2++;
  }
  return { full: new Set(picked.map((p) => p.r.id)), tier };
}

/** Writes ranks + selection + tiers for the whole brief. */
async function saveSelection(perTopic: { topicId: number; ordered: RankRow[] }[]): Promise<void> {
  const sel = selectBrief(perTopic);
  const updates = perTopic.flatMap(({ ordered }) =>
    ordered.map((r, i) => ({ id: r.id, rank: i + 1, in_brief: sel.full.has(r.id), tier: sel.tier.get(r.id) ?? null })),
  );
  await q(
    `UPDATE brief_items bi SET rank = v.rank, in_brief = v.in_brief, tier = v.tier, also_shown_in = NULL
     FROM jsonb_to_recordset($1::jsonb) AS v(id int, rank int, in_brief boolean, tier int) WHERE bi.id = v.id`,
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
