// Daily 3 — Clean record. Code removes repeats (same arXiv ID / DOI / title = one record; Neon's
// unique key backs this up). Gemini writes the one-line summary, sets Preprint / Peer-reviewed
// from the facts given, and flags research-site pages that are not actually papers.
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, resultsArray, S, type UsageCtx } from "../gemini";
import { mergePapers } from "../papers";
import type { Topic } from "../db";
import { drain, type DrainResult } from "./drain";

interface Row {
  id: number;
  title: string;
  abstract: string;
  found_via: string;
  doi: string | null;
  journal_ref: string | null;
  venue: string | null;
  arxiv_comment: string | null;
  arxiv_id: string | null;
  clean_attempts: number;
}

const PEER_SITES = new Set(["acl", "cvf", "ieee", "acm"]);

/** Peer-reviewed is only allowed when a fact supports it (evidence-rules.md). */
export function peerReviewAllowed(r: Pick<Row, "doi" | "journal_ref" | "venue" | "found_via">): boolean {
  return Boolean(r.doi || r.venue || r.journal_ref || PEER_SITES.has(r.found_via));
}

const INSTRUCTIONS = `STEP: CLEAN RECORD (one line per paper).
For EVERY paper in the input return:
- one_line: one plain-English sentence (max 25 words) saying what the paper does. No hype words.
- pub_status: "peer_reviewed" or "preprint", following evidence-rules.md and ONLY the facts given (doi, journal_ref, venue, source). No facts → "preprint".
- is_research_paper: false only if the item is clearly not a research paper (a call for papers, a venue home page, a workshop index, a table of contents). Otherwise true.
Return {"results": [{"pid", "one_line", "pub_status", "is_research_paper"}]} with one entry per input pid.`;

const SCHEMA = S.obj({
  results: S.arr(
    S.obj({ pid: S.int(), one_line: S.str(), pub_status: S.enumOf(["preprint", "peer_reviewed"]), is_research_paper: S.bool() }),
  ),
});

/** Same title already stored under another key → fold into the older record (code, not AI). */
async function dedupeByTitle(rows: Row[]): Promise<Row[]> {
  const dupes = await q<{ id: number; keep: number }>(
    `SELECT n.id, (SELECT o.id FROM papers o
                   WHERE o.title_norm = n.title_norm AND o.id <> n.id
                   ORDER BY (o.arxiv_id IS NULL), o.id LIMIT 1) AS keep
     FROM papers n WHERE n.id = ANY($1::int[]) AND length(n.title) > 20`,
    [rows.map((r) => r.id)],
  );
  const merged = new Set<number>();
  for (const d of dupes) {
    if (!d.keep || merged.has(d.keep)) continue;
    const row = rows.find((r) => r.id === d.id);
    // Keep the arXiv record when one side has it; otherwise the older one.
    const [keep, drop] = row?.arxiv_id ? [d.id, d.keep] : [d.keep, d.id];
    await mergePapers(keep, drop);
    merged.add(drop);
  }
  return rows.filter((r) => !merged.has(r.id));
}

async function handle(batch: Row[], topics: Topic[], ctx: UsageCtx): Promise<void> {
  const rows = await dedupeByTitle(batch);
  if (!rows.length) return;
  const input = rows.map((r) => ({
    pid: r.id,
    title: r.title,
    summary: r.abstract.slice(0, 900),
    source: r.found_via,
    facts: { doi: r.doi, journal_ref: r.journal_ref, venue: r.venue, arxiv_comment: r.arxiv_comment?.slice(0, 200) ?? null },
  }));
  const res = await geminiJson({
    step: "clean",
    system: systemPrompt(topics, INSTRUCTIONS),
    user: JSON.stringify({ papers: input }),
    schema: SCHEMA,
    items: rows.length,
    ctx,
    validate: (o) => resultsArray(o),
  });
  const byPid = new Map(res.ok ? res.data.map((r) => [Number(r.pid), r]) : []);
  const done: { id: number; one_line: string; pub_status: string; is_paper: boolean }[] = [];
  const missed: number[] = [];
  for (const r of rows) {
    const g = byPid.get(r.id);
    if (g && typeof g.one_line === "string" && g.one_line.trim()) {
      const peer = g.pub_status === "peer_reviewed" && peerReviewAllowed(r);
      done.push({
        id: r.id,
        one_line: g.one_line.trim().slice(0, 300),
        pub_status: peer ? "peer_reviewed" : "preprint",
        is_paper: r.found_via === "arxiv" ? true : g.is_research_paper !== false,
      });
    } else missed.push(r.id);
  }
  if (done.length)
    await q(
      `UPDATE papers p SET one_line = v.one_line, pub_status = v.pub_status, is_research_paper = v.is_paper, clean_status = 'assessed'
       FROM jsonb_to_recordset($1::jsonb) AS v(id int, one_line text, pub_status text, is_paper boolean) WHERE p.id = v.id`,
      [JSON.stringify(done)],
    );
  // Gemini failed or skipped them: try once more, then keep as "not assessed" (still counted, still shown).
  if (missed.length)
    await q(
      `UPDATE papers SET clean_attempts = clean_attempts + 1,
         clean_status = CASE WHEN clean_attempts + 1 >= 2 THEN 'not_assessed' ELSE 'pending' END,
         pub_status = CASE WHEN doi IS NOT NULL OR venue IS NOT NULL THEN 'peer_reviewed' ELSE pub_status END
       WHERE id = ANY($1::int[])`,
      [missed],
    );
}

export function cleanPending(topics: Topic[], ctx: UsageCtx, deadline: number): Promise<DrainResult> {
  return drain<Row>({
    load: (limit) =>
      q<Row>(
        `SELECT id, title, abstract, found_via, doi, journal_ref, venue, arxiv_comment, arxiv_id, clean_attempts
         FROM papers WHERE clean_status = 'pending' AND confirm_status = 'confirmed' ORDER BY id LIMIT $1`,
        [limit],
      ),
    batchSize: 25,
    deadline,
    handle: (b) => handle(b, topics, ctx),
  });
}
