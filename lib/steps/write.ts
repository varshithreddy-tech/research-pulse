// Monday 5 — Write the brief (brief-format.md). ONE Gemini call writes:
//   - one "What's changing" sentence per topic (plain English, max 25 words), and
//   - "What it's about" (2–3 plain sentences) and "Why it may matter" (one plain sentence) ONLY for
//     papers shown in full in the brief.
// Code lays out titles, links, facts and counts exactly as stored and renders the email and the
// dashboard version. If Gemini fails, a plain template is used (and the paper's one-line summary).
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, isObj, resultsArray, S, type UsageCtx } from "../gemini";
import type { Topic } from "../db";
import type { TopicCounts } from "../brief";
import { dehype, PLAIN_RULES } from "../plain";
import { cleanLine } from "./importance";

export const MAX_CHANGING_WORDS = 25;

const INSTRUCTIONS = `STEP: WRITE THE BRIEF (brief-format.md). The reader is a busy business consultant, not a researcher.
${PLAIN_RULES}

Two jobs:
1. "topics": for EVERY topic given, ONE sentence of at most 25 words on the direction this week's on-topic papers
   point to. Base it only on the papers listed for that topic. No acronyms, no numbers or counts.
   If they are mostly incremental, say the week was quiet.
2. "papers": for EVERY paper given:
   - "about": 2–3 short sentences — the problem, what the authors did, what they found. Use only the title and
     summary given; never add results that are not in them.
   - "why": ONE sentence on why it may matter to a company — what decision, cost or risk it touches.
     "why_hint" is a draft; rewrite it in plain words.
Return {"topics": [{"topic_id", "whats_changing"}], "papers": [{"pid", "about", "why"}]}.`;

const SCHEMA = S.obj({
  topics: S.arr(S.obj({ topic_id: S.int(), whats_changing: S.str() })),
  papers: S.arr(S.obj({ pid: S.int(), about: S.str(), why: S.str() })),
});

/** Hard cap so a long answer can never blow the 10-minute read: at most 25 words. */
export function capWords(s: string, max = MAX_CHANGING_WORDS): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return s.trim();
  return `${words.slice(0, max).join(" ").replace(/[,;:]$/, "")}…`;
}

export async function writeBrief(
  briefId: number,
  topics: Topic[],
  counts: TopicCounts[],
  ctx: UsageCtx,
): Promise<{ sentences: Record<string, string>; by: "gemini" | "template" }> {
  const items = await q<{ topic_id: number; title: string; type: string | null; score: number | null; line1: string | null }>(
    `SELECT bi.topic_id, p.title, bi.type, bi.score, bi.reason_line1 AS line1
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id
     WHERE bi.brief_id = $1 AND bi.importance_status = 'assessed' AND NOT bi.older
     ORDER BY bi.topic_id, bi.rank NULLS LAST`,
    [briefId],
  );
  // Papers shown in full: the only ones that get "What it's about" and a plain "Why it may matter".
  const shown = await q<{ pid: number; title: string; abstract: string; one_line: string | null; why_hint: string | null }>(
    `SELECT DISTINCT ON (p.id) p.id AS pid, p.title, p.abstract, p.one_line, bi.reason_line2 AS why_hint
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id WHERE bi.brief_id = $1 AND bi.in_brief
     ORDER BY p.id`,
    [briefId],
  );
  const withPapers = counts.filter((c) => c.relevant > 0 && items.some((i) => i.topic_id === c.topic_id));

  const res =
    withPapers.length || shown.length
      ? await geminiJson({
          step: "write",
          system: systemPrompt(topics, INSTRUCTIONS),
          user: JSON.stringify({
            topics: withPapers.map((c) => ({
              topic_id: c.topic_id,
              name: c.name,
              on_topic_papers: items
                .filter((i) => i.topic_id === c.topic_id)
                .slice(0, 8)
                .map((i) => ({ title: i.title, type: i.type, score: i.score, claim: i.line1 })),
            })),
            papers: shown.map((p) => ({ pid: p.pid, title: p.title, summary: p.abstract.slice(0, 1500), why_hint: p.why_hint })),
          }),
          schema: SCHEMA,
          items: withPapers.length + shown.length,
          ctx,
          validate: (o) => (isObj(o) && resultsArray(o, "topics") && resultsArray(o, "papers") ? o : null),
        })
      : null;

  const sentences: Record<string, string> = {};
  const abouts = new Map<number, string>();
  const whys = new Map<number, string>();
  if (res?.ok) {
    for (const r of resultsArray(res.data, "topics") ?? []) {
      const id = Number(r.topic_id);
      const s = capWords(dehype(cleanLine(r.whats_changing)));
      if (withPapers.some((c) => c.topic_id === id) && s) sentences[String(id)] = s;
    }
    for (const r of resultsArray(res.data, "papers") ?? []) {
      const about = dehype(cleanLine(r.about, 700));
      if (about) abouts.set(Number(r.pid), about);
      const why = dehype(cleanLine(r.why, 300));
      if (why) whys.set(Number(r.pid), why);
    }
  }
  // Fallbacks so a card is never blank: the one-line summary; Question 2's line 2 (shown with hype removed).
  const rows = shown.map((p) => ({ pid: p.pid, about: abouts.get(p.pid) ?? p.one_line ?? "", why: whys.get(p.pid) ?? null }));
  if (rows.length)
    await q(
      `UPDATE brief_items bi SET about = v.about, why = v.why
       FROM jsonb_to_recordset($2::jsonb) AS v(pid int, about text, why text)
       WHERE bi.brief_id = $1 AND bi.paper_id = v.pid`,
      [briefId, JSON.stringify(rows)],
    );
  return { sentences, by: res?.ok ? "gemini" : "template" };
}
