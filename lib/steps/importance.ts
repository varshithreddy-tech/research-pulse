// Monday 3 — Question 2 (importance.md): type, 0–10 score and a 2-line reason, with Kavita's past
// marks as context. Importance is a property of the PAPER, so it is judged once per paper and the
// result is reused for every topic the paper is relevant to. A failed call → the paper is kept,
// marked "not assessed", and still counted.
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, resultsArray, S, type UsageCtx } from "../gemini";
import type { Topic } from "../db";
import { drain, type DrainResult } from "./drain";

const TYPES = ["new_test", "surprising_result", "new_way_to_see_problem", "nothing_new"];
const BANNED = /\b(validated|breakthrough|groundbreaking|revolutionary|state[- ]of[- ]the[- ]art)\b/gi;

/** One paper waiting for Question 2 in this brief (all its topic rows together). */
interface Row {
  pid: number;
  topics: string[];
  title: string;
  abstract: string;
  pub_status: string;
  venue: string | null;
  citations: number | null;
  influential_citations: number | null;
  s2_status: string;
  hf_upvotes: number | null;
  hf_status: string;
  code_url: string | null;
  blog_count: number;
  older: boolean;
  published_year: number | null;
  discussed_in: string[];
}

const INSTRUCTIONS = `STEP: QUESTION 2 — Why might this paper matter? Follow importance.md exactly.
Judge each PAPER once (it may be relevant to several of Kavita's topics, listed in "topics").
For EVERY paper return {"pid", "type", "score", "line1", "line2"}:
- type: one of new_test | surprising_result | new_way_to_see_problem | nothing_new
- score: integer 0–10 (nothing_new ⇔ 0)
- line1: what it claims (one sentence). line2: why it might matter to a company's AI strategy (one sentence).
Facts are attention signals, not quality. "not available" means the source failed — do not treat it as zero.
An "older paper" was published before this week and is only being discussed now; judge it on its own merits.
Use "kavita_past_marks" only to calibrate what she values.
Return {"results": [...]}, one entry per pid.`;

const SCHEMA = S.obj({
  results: S.arr(S.obj({ pid: S.int(), type: S.enumOf(TYPES), score: S.int(), line1: S.str(), line2: S.str() })),
});

/** Kavita's recent marks: what she read, shared, found not useful, or said the system missed. */
export async function pastMarks(): Promise<unknown[]> {
  return q(
    `SELECT m.kind, COALESCE(p.title, m.missed_url) AS paper, t.name AS topic, to_char(m.created_at, 'YYYY-MM-DD') AS date
     FROM marks m LEFT JOIN papers p ON p.id = m.paper_id LEFT JOIN topics t ON t.id = m.topic_id
     WHERE m.created_at > now() - interval '90 days' ORDER BY m.created_at DESC LIMIT 40`,
  );
}

export function cleanLine(s: unknown, max = 300): string {
  return String(s ?? "").replace(BANNED, "notable").replace(/\s+/g, " ").trim().slice(0, max);
}

/** nothing_new ⇔ score 0; score clamped to 0–10. */
export function normalizeVerdict(type: string, score: number): { type: string; score: number } {
  let s = Math.max(0, Math.min(10, Math.round(Number.isFinite(score) ? score : 0)));
  let t = TYPES.includes(type) ? type : "nothing_new";
  if (t === "nothing_new") s = 0;
  else if (s === 0) t = "nothing_new";
  return { type: t, score: s };
}

async function handle(briefId: number, rows: Row[], topics: Topic[], marks: unknown[], ctx: UsageCtx): Promise<void> {
  const res = await geminiJson({
    step: "importance",
    system: systemPrompt(topics, INSTRUCTIONS),
    user: JSON.stringify({
      kavita_past_marks: marks,
      papers: rows.map((r) => ({
        pid: r.pid,
        topics: r.topics,
        title: r.title,
        summary: r.abstract.slice(0, 1400),
        facts: {
          status: r.pub_status === "peer_reviewed" ? `Peer-reviewed${r.venue ? ` (${r.venue})` : ""}` : "Preprint",
          ...(r.older ? { older_paper: `published ${r.published_year ?? "before this week"}, discussed this week` } : {}),
          citations: r.s2_status === "ok" ? r.citations : r.s2_status === "not_found" ? "not yet indexed" : "not available",
          influential_citations: r.s2_status === "ok" ? r.influential_citations : "not available",
          hugging_face_upvotes: r.hf_status === "ok" ? r.hf_upvotes : r.hf_status === "not_listed" ? "not featured" : "not available",
          code_shared: Boolean(r.code_url),
          blogs_discussing: r.blog_count,
          discussed_in: r.discussed_in.slice(0, 3),
        },
      })),
    }),
    schema: SCHEMA,
    items: rows.length,
    ctx,
    validate: (o) => resultsArray(o),
  });
  const byPid = new Map(res.ok ? res.data.map((r) => [Number(r.pid), r]) : []);
  const done: { pid: number; type: string; score: number; l1: string; l2: string }[] = [];
  const missed: number[] = [];
  for (const r of rows) {
    const g = byPid.get(r.pid);
    if (g && g.line1 && g.line2) {
      const v = normalizeVerdict(String(g.type), Number(g.score));
      done.push({ pid: r.pid, type: v.type, score: v.score, l1: cleanLine(g.line1), l2: cleanLine(g.line2) });
    } else missed.push(r.pid);
  }
  // One verdict per paper, copied to every topic row of that paper in this brief.
  if (done.length)
    await q(
      `UPDATE brief_items bi SET importance_status = 'assessed', type = v.type, score = v.score, reason_line1 = v.l1, reason_line2 = v.l2
       FROM jsonb_to_recordset($2::jsonb) AS v(pid int, type text, score int, l1 text, l2 text)
       WHERE bi.brief_id = $1 AND bi.paper_id = v.pid AND bi.importance_status = 'pending'`,
      [briefId, JSON.stringify(done)],
    );
  // Failed: one more try, then "not assessed" — kept and counted.
  if (missed.length)
    await q(
      `UPDATE brief_items SET importance_attempts = importance_attempts + 1,
         importance_status = CASE WHEN importance_attempts + 1 >= 2 THEN 'not_assessed' ELSE 'pending' END
       WHERE brief_id = $1 AND paper_id = ANY($2::int[]) AND importance_status = 'pending'`,
      [briefId, missed],
    );
}

export async function scoreBrief(briefId: number, topics: Topic[], ctx: UsageCtx, deadline: number): Promise<DrainResult> {
  const marks = await pastMarks();
  return drain<Row>({
    load: (limit) =>
      q<Row>(
        `SELECT p.id AS pid, array_agg(DISTINCT t.name) AS topics, p.title, p.abstract, p.pub_status,
           COALESCE(p.venue, max(bi.s2_venue)) AS venue, max(bi.citations) AS citations,
           max(bi.influential_citations) AS influential_citations, max(bi.s2_status) AS s2_status,
           max(bi.hf_upvotes) AS hf_upvotes, max(bi.hf_status) AS hf_status,
           COALESCE(max(bi.code_url), p.code_url) AS code_url, max(bi.blog_count)::int AS blog_count,
           bool_or(bi.older) AS older, max(bi.published_year) AS published_year,
           COALESCE((SELECT array_agg(b.title) FROM blogs b WHERE b.linked_paper_id = p.id), '{}') AS discussed_in
         FROM brief_items bi JOIN papers p ON p.id = bi.paper_id JOIN topics t ON t.id = bi.topic_id
         WHERE bi.brief_id = $1 AND bi.importance_status = 'pending'
         GROUP BY p.id ORDER BY p.id LIMIT $2`,
        [briefId, limit],
      ),
    batchSize: 10,
    deadline,
    handle: (b) => handle(briefId, b, topics, marks, ctx),
  });
}
