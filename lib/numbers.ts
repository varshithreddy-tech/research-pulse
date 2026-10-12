// Every number the brief shows, from one definition (point: "make every number consistent").
//   scanned   = unique NEW research papers found in the week (Mon–Sun IST) for at least one active topic
//   on_topic  = unique scanned papers judged on-topic for at least one active topic
//   picked    = papers picked for the brief (each paper once, under its home topic)
// Per topic (papers can fit more than one topic, so per-topic numbers add up to more than the totals):
//   scanned_t = scanned papers checked for topic t;  on_topic_t = those judged on-topic for t
//   shown_t   = picked papers whose home topic is t; more_t = on_topic_t − shown_t ("+ N more")
// The brief, the email, All papers and Cost & coverage all read these same counts.
import { q } from "./db";
import type { WindowCounts } from "./brief";

/**
 * An "older paper": reached us through a blog, a research-site search or "You missed this" (not the
 * arXiv category fetch) and was published before the week starts. Kept and listed in All papers,
 * labelled "Older paper (YEAR) — discussed this week", never counted as new and never picked.
 * `p` is the papers alias; `start` the SQL expression for the week start.
 */
export function olderSql(p: string, start: string): string {
  return `(${p}.found_via <> 'arxiv' AND ${p}.published_at IS NOT NULL AND ${p}.published_at < ${start})`;
}

export interface TopicNumbers {
  topic_id: number;
  scanned: number;
  on_topic: number;
  shown: number;
  more: number;
}

export interface BriefNumbers {
  scanned: number;
  on_topic: number;
  picked: number;
  topics: TopicNumbers[];
}

export function briefNumbers(counts: WindowCounts, picked: { topic_id: number }[]): BriefNumbers {
  const topics = counts.topics.map((t) => {
    const shown = picked.filter((p) => p.topic_id === t.topic_id).length;
    return { topic_id: t.topic_id, scanned: t.checked, on_topic: t.relevant, shown, more: Math.max(0, t.relevant - shown) };
  });
  return { scanned: counts.papers_checked, on_topic: counts.on_topic, picked: picked.length, topics };
}

/** Every rule the numbers must follow; returns the broken ones (empty = all consistent). */
export function numberProblems(n: BriefNumbers): string[] {
  const out: string[] = [];
  if (n.on_topic > n.scanned) out.push(`on-topic ${n.on_topic} > scanned ${n.scanned}`);
  if (n.picked > n.on_topic) out.push(`picked ${n.picked} > on-topic ${n.on_topic}`);
  const shown = n.topics.reduce((s, t) => s + t.shown, 0);
  if (shown !== n.picked) out.push(`picked ${n.picked} ≠ sum of papers shown per topic ${shown}`);
  const maxTopic = Math.max(0, ...n.topics.map((t) => t.on_topic));
  const sumTopic = n.topics.reduce((s, t) => s + t.on_topic, 0);
  if (maxTopic > n.on_topic) out.push(`a topic has ${maxTopic} on-topic, more than the unique total ${n.on_topic}`);
  if (sumTopic < n.on_topic) out.push(`per-topic on-topic adds to ${sumTopic}, less than the unique total ${n.on_topic}`);
  const maxScanned = Math.max(0, ...n.topics.map((t) => t.scanned));
  if (maxScanned > n.scanned) out.push(`a topic has ${maxScanned} scanned, more than the unique total ${n.scanned}`);
  for (const t of n.topics) {
    if (t.on_topic > t.scanned) out.push(`topic ${t.topic_id}: on-topic ${t.on_topic} > scanned ${t.scanned}`);
    if (t.shown + t.more !== t.on_topic) out.push(`topic ${t.topic_id}: shown ${t.shown} + more ${t.more} ≠ on-topic ${t.on_topic}`);
  }
  return out;
}

/** Estimated reading time: words on the page at 200 words a minute, rounded up. */
export function readMinutes(texts: (string | null | undefined)[]): number {
  const words = texts.reduce((s, t) => s + (t ? t.trim().split(/\s+/).filter(Boolean).length : 0), 0);
  return Math.max(1, Math.ceil(words / 200));
}

// ---------- All papers: the same definitions, one row per paper ----------
// Params: $1 week start, $2 week end, $3 topic id or NULL, $4 brief id or NULL.

/** One row per paper found in the week (optionally only papers checked for one topic). */
export function paperWeekCte(): string {
  return `w AS (
    SELECT p.id,
      (p.confirm_status = 'confirmed' AND p.is_research_paper) AS ok,
      ${olderSql("p", "$1")} AS older,
      bool_or(t.active) AS any_active,
      bool_or(t.active AND pt.status = 'assessed' AND pt.relevant) AS rel,
      bool_or(t.active AND pt.status IN ('pending', 'not_assessed')) AS waiting,
      (SELECT bi.topic_id FROM brief_items bi WHERE bi.brief_id = $4 AND bi.paper_id = p.id AND bi.in_brief LIMIT 1) AS home
    FROM papers p JOIN paper_topics pt ON pt.paper_id = p.id JOIN topics t ON t.id = pt.topic_id
    WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND ($3::int IS NULL OR pt.topic_id = $3)
    GROUP BY p.id)`;
}

const SCANNED = "(w.ok AND NOT w.older AND w.any_active)";
const PICKED = `(${SCANNED} AND w.rel AND w.home IS NOT NULL AND ($3::int IS NULL OR w.home = $3))`;

/** Status filters on All papers. scanned = on_topic + not_relevant + not_assessed; on_topic = picked + more. */
export const PAPER_STATUS: Record<string, { label: string; sql: string }> = {
  all: { label: "All", sql: "TRUE" },
  scanned: { label: "Scanned", sql: SCANNED },
  on_topic: { label: "On her topics", sql: `(${SCANNED} AND w.rel)` },
  picked: { label: "Picked", sql: PICKED },
  more: { label: "More on-topic", sql: `(${SCANNED} AND w.rel AND NOT ${PICKED})` },
  notrel: { label: "Not relevant", sql: `(${SCANNED} AND NOT w.rel AND NOT w.waiting)` },
  na: { label: "Not assessed", sql: `(${SCANNED} AND NOT w.rel AND w.waiting)` },
  older: { label: "Older", sql: "(w.ok AND w.older)" },
  unconfirmed: { label: "Could not confirm", sql: "(NOT w.ok)" },
};

/** Unique papers per status for a week (and optionally one topic), relative to a brief's picks. */
export async function paperStatusCounts(ws: Date | string, we: Date | string, topicId: number | null, briefId: number | null): Promise<Record<string, number>> {
  const rows = await q<{ k: string; n: number }>(
    `WITH ${paperWeekCte()} ${Object.entries(PAPER_STATUS).map(([k, s]) => `SELECT '${k}' AS k, count(*)::int AS n FROM w WHERE ${s.sql}`).join(" UNION ALL ")}`,
    [ws, we, topicId, briefId],
  );
  return Object.fromEntries(rows.map((r) => [r.k, r.n]));
}

/**
 * Momentum: on-topic papers per topic for the brief's week and the weeks before it (same definition
 * as on_topic_t, each week judged against its own start). `weeks` oldest → newest; the last value is
 * the brief's week. `hasHistory` is false when no earlier week has any papers yet.
 */
export async function topicMomentum(ws: Date | string, back = 5): Promise<{ weeks: string[]; byTopic: Map<number, number[]>; hasHistory: boolean }> {
  const start = new Date(new Date(ws).getTime() - back * 7 * 86_400_000);
  const weeks = Array.from({ length: back + 1 }, (_, i) => new Date(start.getTime() + i * 7 * 86_400_000).toISOString());
  const WK = `(date_trunc('week', p.first_seen_at AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const rows = await q<{ topic_id: number; wk: string; n: number }>(
    `SELECT pt.topic_id, ${WK} AS wk, count(DISTINCT pt.paper_id)::int AS n
     FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id JOIN topics t ON t.id = pt.topic_id AND t.active
     WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed' AND p.is_research_paper
       AND NOT ${olderSql("p", WK)} AND pt.status = 'assessed' AND pt.relevant
     GROUP BY 1, 2`,
    [start.toISOString(), new Date(new Date(ws).getTime() + 7 * 86_400_000).toISOString()],
  );
  const byTopic = new Map<number, number[]>();
  for (const r of rows) {
    const k = weeks.indexOf(new Date(r.wk).toISOString());
    if (k < 0) continue;
    const arr = byTopic.get(r.topic_id) ?? weeks.map(() => 0);
    arr[k] = r.n;
    byTopic.set(r.topic_id, arr);
  }
  const hasHistory = [...byTopic.values()].some((arr) => arr.slice(0, -1).some((n) => n > 0));
  return { weeks, byTopic, hasHistory };
}
