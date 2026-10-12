// Daily 5 — Qualifying check (Question 1). Every paper fetched by category is judged against each
// topic whose categories it is listed in, using the topic's plain-English focus. One Gemini call
// judges a batch of papers against all their candidate topics. Yes / No + a one-line reason.
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, isObj, resultsArray, S, type UsageCtx } from "../gemini";
import type { Topic } from "../db";
import { drain, type DrainResult } from "./drain";

interface Row {
  id: number;
  title: string;
  abstract: string;
  categories: string[];
  topic_ids: number[];
}

const INSTRUCTIONS = `STEP: QUALIFYING CHECK (Question 1) — is this paper really about this topic?
For EVERY paper, judge it against EVERY topic_id listed in its "candidate_topics" (and only those).
Use each topic's "focus" from the topic list. The search words are hints, not requirements: a paper can be on-topic without using them.
A paper is relevant if its main contribution is about the topic's focus — not if it only mentions it in passing or uses it as a minor tool.
Return {"results": [{"pid", "judgments": [{"topic_id", "relevant", "reason"}]}]}.
reason: if relevant is false, about 10 words saying why not; if true, one short line (max 20 words) saying why.`;

const SCHEMA = S.obj({
  results: S.arr(
    S.obj({
      pid: S.int(),
      judgments: S.arr(S.obj({ topic_id: S.int(), relevant: S.bool(), reason: S.str() })),
    }),
  ),
});

async function handle(rows: Row[], topics: Topic[], ctx: UsageCtx): Promise<void> {
  const input = rows.map((r) => ({
    pid: r.id,
    title: r.title,
    summary: r.abstract.slice(0, 1200),
    arxiv_categories: r.categories,
    candidate_topics: r.topic_ids,
  }));
  const res = await geminiJson({
    step: "qualify",
    system: systemPrompt(topics, INSTRUCTIONS),
    user: JSON.stringify({ papers: input }),
    schema: SCHEMA,
    items: rows.length,
    ctx,
    validate: (o) => resultsArray(o),
  });

  const verdicts: { paper_id: number; topic_id: number; relevant: boolean; reason: string }[] = [];
  if (res.ok) {
    for (const r of res.data) {
      const row = rows.find((x) => x.id === Number(r.pid));
      if (!row || !Array.isArray(r.judgments)) continue;
      for (const j of r.judgments.filter(isObj)) {
        const tid = Number(j.topic_id);
        if (!row.topic_ids.includes(tid) || typeof j.relevant !== "boolean") continue;
        verdicts.push({ paper_id: row.id, topic_id: tid, relevant: j.relevant, reason: String(j.reason ?? "").slice(0, 300) });
      }
    }
  }
  if (verdicts.length) {
    await q(
      `UPDATE paper_topics pt SET status = 'assessed', relevant = v.relevant, reason = v.reason, checked_at = now()
       FROM jsonb_to_recordset($1::jsonb) AS v(paper_id int, topic_id int, relevant boolean, reason text)
       WHERE pt.paper_id = v.paper_id AND pt.topic_id = v.topic_id`,
      [JSON.stringify(verdicts)],
    );
  }
  // Pairs Gemini did not answer: one more try, then "not assessed" — kept and counted, never dropped.
  await q(
    `UPDATE paper_topics SET attempts = attempts + 1,
       status = CASE WHEN attempts + 1 >= 2 THEN 'not_assessed' ELSE 'pending' END,
       reason = CASE WHEN attempts + 1 >= 2 THEN 'Not assessed: the AI check failed' ELSE reason END,
       checked_at = CASE WHEN attempts + 1 >= 2 THEN now() ELSE checked_at END
     WHERE status = 'pending' AND paper_id = ANY($1::int[]) AND topic_id IN (SELECT id FROM topics WHERE active)`,
    [rows.map((r) => r.id)],
  );
}

export function qualifyPending(topics: Topic[], ctx: UsageCtx, deadline: number): Promise<DrainResult> {
  return drain<Row>({
    load: (limit) =>
      q<Row>(
        `SELECT p.id, p.title, p.abstract, p.categories, array_agg(pt.topic_id ORDER BY pt.topic_id) AS topic_ids
         FROM paper_topics pt
         JOIN papers p ON p.id = pt.paper_id
         JOIN topics t ON t.id = pt.topic_id AND t.active
         WHERE pt.status = 'pending' AND p.confirm_status = 'confirmed'
         GROUP BY p.id ORDER BY p.id LIMIT $1`,
        [limit],
      ),
    batchSize: 20,
    deadline,
    handle: (b) => handle(b, topics, ctx),
  });
}
