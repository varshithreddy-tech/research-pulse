// Monday 2 — Reaction numbers: Semantic Scholar (citations, influential citations, venue, authors'
// past work), Hugging Face (upvotes, code link), and how many saved blogs discuss each paper.
// A source that fails is marked "not available" — the brief carries on without it.
import { appendRunError, q } from "../db";
import { authorInfo, s2Batch, s2Venue } from "../sources/semanticScholar";
import { hfDailyPapers } from "../sources/huggingface";

interface Row {
  paper_id: number;
  arxiv_id: string | null;
  doi: string | null;
}

export async function gatherReactions(briefId: number, weekStart: Date, weekEnd: Date, runId: number): Promise<void> {
  const papers = await q<Row>(
    `SELECT DISTINCT p.id AS paper_id, p.arxiv_id, p.doi FROM brief_items bi JOIN papers p ON p.id = bi.paper_id
     WHERE bi.brief_id = $1 AND bi.relevance = 'yes'`,
    [briefId],
  );
  // Items whose relevance could not be assessed are not scored, so their reaction numbers are not looked up.
  await q(`UPDATE brief_items SET s2_status = 'not_available', hf_status = 'not_available' WHERE brief_id = $1 AND relevance <> 'yes'`, [briefId]);

  // Semantic Scholar
  const withId = papers.filter((p) => p.arxiv_id || p.doi);
  const s2Rows: Record<string, unknown>[] = papers.filter((p) => !p.arxiv_id && !p.doi).map((p) => ({ paper_id: p.paper_id, status: "not_found" }));
  try {
    const res = await s2Batch(withId.map((p) => (p.arxiv_id ? `ARXIV:${p.arxiv_id}` : `DOI:${p.doi}`)));
    withId.forEach((p, i) => {
      const s = res[i];
      s2Rows.push(
        s
          ? {
              paper_id: p.paper_id,
              status: "ok",
              citations: s.citationCount ?? 0,
              influential: s.influentialCitationCount ?? 0,
              venue: s2Venue(s),
              author_info: authorInfo(s),
            }
          : { paper_id: p.paper_id, status: "not_found" },
      );
    });
  } catch (e) {
    for (const p of withId) s2Rows.push({ paper_id: p.paper_id, status: "not_available" });
    await appendRunError(runId, "semantic scholar", String(e));
  }
  await q(
    `UPDATE brief_items bi SET s2_status = v.status, citations = v.citations, influential_citations = v.influential,
       s2_venue = v.venue, author_info = v.author_info
     FROM jsonb_to_recordset($2::jsonb) AS v(paper_id int, status text, citations int, influential int, venue text, author_info text)
     WHERE bi.brief_id = $1 AND bi.paper_id = v.paper_id`,
    [briefId, JSON.stringify(s2Rows)],
  );
  // evidence-rules.md: an arXiv paper with a Semantic Scholar venue is Peer-reviewed.
  await q(
    `UPDATE papers p SET venue = COALESCE(p.venue, v.venue), pub_status = 'peer_reviewed'
     FROM jsonb_to_recordset($1::jsonb) AS v(paper_id int, venue text)
     WHERE p.id = v.paper_id AND v.venue IS NOT NULL`,
    [JSON.stringify(s2Rows)],
  );

  // Hugging Face
  try {
    const hf = await hfDailyPapers(new Date(weekStart.getTime() - 2 * 86_400_000), weekEnd);
    const rows = papers.map((p) => {
      const h = p.arxiv_id ? hf.get(p.arxiv_id) : undefined;
      return h ? { paper_id: p.paper_id, status: "ok", upvotes: h.upvotes, code: h.code_url } : { paper_id: p.paper_id, status: "not_listed" };
    });
    await q(
      `UPDATE brief_items bi SET hf_status = v.status, hf_upvotes = v.upvotes, code_url = COALESCE(v.code, bi.code_url)
       FROM jsonb_to_recordset($2::jsonb) AS v(paper_id int, status text, upvotes int, code text)
       WHERE bi.brief_id = $1 AND bi.paper_id = v.paper_id`,
      [briefId, JSON.stringify(rows)],
    );
  } catch (e) {
    await q(`UPDATE brief_items SET hf_status = 'not_available' WHERE brief_id = $1`, [briefId]);
    await appendRunError(runId, "hugging face", String(e));
  }

  // Blogs discussing each paper (only blogs where the paper was confirmed).
  await q(
    `UPDATE brief_items bi SET blog_count = (SELECT count(*) FROM blogs b WHERE b.linked_paper_id = bi.paper_id)::int
     WHERE bi.brief_id = $1`,
    [briefId],
  );
}
