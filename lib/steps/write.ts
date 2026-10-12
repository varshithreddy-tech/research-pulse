// Monday 5 — Write the brief (brief-format.md). ONE Gemini call writes:
//   - "This week in 30 seconds": 3–4 plain lines on the week, across topics,
//   - per topic: one "What's changing" sentence (max 25 words) and 2–3 short theme tags,
//   - per PICKED paper only: "What it's about", one "why it matters" line, and the client angle —
//     who it matters to, how strong the evidence is (Lab result → Benchmark → Real deployment) and
//     one sentence Kavita could say in a meeting.
// Code lays out titles, links, labs, tiers, facts and counts exactly as stored. If Gemini fails, the
// page falls back to the paper's one-line summary and hides what was not written.
import { q, q1 } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, isObj, resultsArray, S, type UsageCtx } from "../gemini";
import type { Topic } from "../db";
import type { TopicCounts } from "../brief";
import { dehype, PLAIN_RULES } from "../plain";
import { cleanLine } from "./importance";

export const MAX_CHANGING_WORDS = 25;
export const EVIDENCE = ["lab_result", "benchmark", "real_deployment"] as const;
export const EVIDENCE_LABEL = ["Lab result", "Benchmark", "Real deployment"] as const;

export interface SummaryLine {
  lead: string;
  detail: string;
  topic_ids: number[];
}
export interface Theme {
  tag: string;
  recurring: boolean; // also a theme last week (↻)
}

const INSTRUCTIONS = `STEP: WRITE THE BRIEF (brief-format.md). The reader is a busy business consultant, not a researcher.
${PLAIN_RULES}

Four jobs. Use ONLY the titles, summaries and claims given. Never add a result, number, lab or name that is not in them.
1. "summary": 3 or 4 items — the week in 30 seconds, across ALL topics, most useful first. Each item:
   "lead" = a short plain headline (max 10 words, ends with a full stop); "detail" = one plain sentence (max 25 words);
   "topic_ids" = the 1–2 topics it comes from. Draw mostly from the "bring_to_client" and "read_this_week" papers.
2. "topics": for EVERY topic given:
   - "whats_changing": ONE sentence, at most 25 words, on the direction this week's on-topic papers point to.
     No acronyms, no numbers. If they are mostly incremental, say the week was quiet.
   - "themes": 2 or 3 short theme tags (2–4 plain words each, lower case, no hype), e.g. "guardrail bypasses".
     If a theme in "last_week_themes" is still a theme this week, reuse its exact wording.
3. "papers": for EVERY paper given:
   - "about": 2–3 short sentences — the problem, what the authors did, what they found.
   - "why": ONE sentence (max 25 words) on why it matters to a company — what decision, cost or risk it touches.
     "why_hint" is a draft; rewrite it in plain words.
   - "audience": who it matters to — industry and/or role, max 12 words, e.g. "Banks and IT service desks running AI agents".
   - "evidence": how far the result has been tested, judged only from the summary — "lab_result" (the authors' own
     experiment or dataset), "benchmark" (measured on standard public tests others use), "real_deployment" (real users,
     real company data or a live system). When unsure, choose the lower level.
   - "say": ONE plain sentence (max 30 words) Kavita could say in a client meeting. A number only if it is in the summary.
Return {"summary": [...], "topics": [{"topic_id", "whats_changing", "themes"}], "papers": [{"pid", "about", "why", "audience", "evidence", "say"}]}.`;

const SCHEMA = S.obj({
  summary: S.arr(S.obj({ lead: S.str(), detail: S.str(), topic_ids: S.arr(S.int()) })),
  topics: S.arr(S.obj({ topic_id: S.int(), whats_changing: S.str(), themes: S.arr(S.str()) })),
  papers: S.arr(
    S.obj({ pid: S.int(), about: S.str(), why: S.str(), audience: S.str(), evidence: S.enumOf([...EVIDENCE]), say: S.str() }),
  ),
});

/** Hard cap so a long answer can never blow the 10-minute read. */
export function capWords(s: string, max = MAX_CHANGING_WORDS): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return s.trim();
  return `${words.slice(0, max).join(" ").replace(/[,;:]$/, "")}…`;
}

const themeKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Up to 3 short tags; ↻ when the same theme (same words) was a theme for this topic last week. */
export function markThemes(tags: unknown, lastWeek: string[]): Theme[] {
  const before = new Set(lastWeek.map(themeKey));
  const out: Theme[] = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = capWords(dehype(cleanLine(raw, 60)).toLowerCase().replace(/[.]+$/, ""), 4).replace(/…$/, "");
    if (!tag || out.some((t) => themeKey(t.tag) === themeKey(tag))) continue;
    out.push({ tag, recurring: before.has(themeKey(tag)) });
    if (out.length === 3) break;
  }
  return out;
}

export async function writeBrief(
  briefId: number,
  topics: Topic[],
  counts: TopicCounts[],
  ctx: UsageCtx,
): Promise<{ sentences: Record<string, string>; by: "gemini" | "template"; summary: SummaryLine[]; themes: Record<string, Theme[]> }> {
  const items = await q<{ topic_id: number; title: string; type: string | null; score: number | null; line1: string | null }>(
    `SELECT bi.topic_id, p.title, bi.type, bi.score, bi.reason_line1 AS line1
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id
     WHERE bi.brief_id = $1 AND bi.importance_status = 'assessed' AND NOT bi.older
     ORDER BY bi.topic_id, bi.rank NULLS LAST`,
    [briefId],
  );
  // Picked papers: the only ones that get "What it's about", "why" and the client angle.
  const picked = await q<{ pid: number; topic_id: number; tier: number | null; title: string; abstract: string; one_line: string | null; why_hint: string | null }>(
    `SELECT p.id AS pid, bi.topic_id, bi.tier, p.title, p.abstract, p.one_line, bi.reason_line2 AS why_hint
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id WHERE bi.brief_id = $1 AND bi.in_brief
     ORDER BY bi.tier NULLS LAST, bi.rank`,
    [briefId],
  );
  // Last week's themes, for ↻ and so a recurring theme keeps its wording.
  const prev = await q1<{ themes: Record<string, Theme[]> | null }>(
    `SELECT b.themes FROM briefs b, briefs cur
     WHERE cur.id = $1 AND b.status = 'done' AND b.themes IS NOT NULL AND b.week_start < cur.week_start
     ORDER BY b.week_start DESC, b.id DESC LIMIT 1`,
    [briefId],
  );
  const lastThemes = (topicId: number) => (prev?.themes?.[String(topicId)] ?? []).map((t) => t.tag);
  const withPapers = counts.filter((c) => c.relevant > 0 && items.some((i) => i.topic_id === c.topic_id));
  const tierName = (t: number | null) => (t === 1 ? "bring_to_client" : t === 2 ? "read_this_week" : "just_so_you_know");

  const res =
    withPapers.length || picked.length
      ? await geminiJson({
          step: "write",
          system: systemPrompt(topics, INSTRUCTIONS),
          user: JSON.stringify({
            topics: withPapers.map((c) => ({
              topic_id: c.topic_id,
              name: c.name,
              last_week_themes: lastThemes(c.topic_id),
              on_topic_papers: items
                .filter((i) => i.topic_id === c.topic_id)
                .slice(0, 8)
                .map((i) => ({ title: i.title, type: i.type, claim: i.line1 })),
            })),
            papers: picked.map((p) => ({
              pid: p.pid,
              topic_id: p.topic_id,
              tier: tierName(p.tier),
              title: p.title,
              summary: p.abstract.slice(0, 1500),
              why_hint: p.why_hint,
            })),
          }),
          schema: SCHEMA,
          items: 1 + withPapers.length + picked.length,
          ctx,
          validate: (o) => (isObj(o) && resultsArray(o, "topics") && resultsArray(o, "papers") && resultsArray(o, "summary") ? o : null),
        })
      : null;

  const sentences: Record<string, string> = {};
  const themes: Record<string, Theme[]> = {};
  const summary: SummaryLine[] = [];
  const written = new Map<number, { about: string | null; why: string | null; audience: string | null; evidence: number | null; say: string | null }>();
  if (res?.ok) {
    const validTopic = new Set(topics.map((t) => t.id));
    for (const r of resultsArray(res.data, "summary") ?? []) {
      const lead = capWords(dehype(cleanLine(r.lead, 120)), 12);
      const detail = capWords(dehype(cleanLine(r.detail, 300)), 30);
      const ids = (Array.isArray(r.topic_ids) ? r.topic_ids : []).map(Number).filter((id) => validTopic.has(id)).slice(0, 2);
      if (lead && detail && summary.length < 4) summary.push({ lead, detail, topic_ids: ids });
    }
    for (const r of resultsArray(res.data, "topics") ?? []) {
      const id = Number(r.topic_id);
      if (!withPapers.some((c) => c.topic_id === id)) continue;
      const s = capWords(dehype(cleanLine(r.whats_changing)));
      if (s) sentences[String(id)] = s;
      const t = markThemes(r.themes, lastThemes(id));
      if (t.length) themes[String(id)] = t;
    }
    for (const r of resultsArray(res.data, "papers") ?? []) {
      const ev = EVIDENCE.indexOf(r.evidence as (typeof EVIDENCE)[number]);
      written.set(Number(r.pid), {
        about: dehype(cleanLine(r.about, 700)) || null,
        why: capWords(dehype(cleanLine(r.why, 300)), 30) || null,
        audience: capWords(dehype(cleanLine(r.audience, 160)), 14) || null,
        evidence: ev >= 0 ? ev + 1 : null,
        say: capWords(dehype(cleanLine(r.say, 300)), 34) || null,
      });
    }
  }
  // Fallbacks so a row is never blank: the one-line summary; Question 2's line 2 (shown with hype removed).
  const rows = picked.map((p) => {
    const w = written.get(p.pid);
    return { pid: p.pid, about: w?.about ?? p.one_line ?? "", why: w?.why ?? null, audience: w?.audience ?? null, evidence: w?.evidence ?? null, say: w?.say ?? null };
  });
  if (rows.length)
    await q(
      `UPDATE brief_items bi SET about = v.about, why = v.why, audience = v.audience, evidence = v.evidence, say = v.say
       FROM jsonb_to_recordset($2::jsonb) AS v(pid int, about text, why text, audience text, evidence int, say text)
       WHERE bi.brief_id = $1 AND bi.paper_id = v.pid`,
      [briefId, JSON.stringify(rows)],
    );
  await q(`UPDATE briefs SET summary = $2, themes = $3 WHERE id = $1`, [briefId, JSON.stringify(summary), JSON.stringify(themes)]);
  return { sentences, by: res?.ok ? "gemini" : "template", summary, themes };
}
