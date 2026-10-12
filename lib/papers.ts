// Saving papers to Neon: insert (unique key enforced by Neon), fan out to topics, merge repeats.
import { q, q1 } from "./db";
import type { ArxivPaper } from "./sources/arxiv";
import type { PaperLink } from "./ids";

/** Inserts arXiv papers (repeats skipped by the unique keys). Returns ids of the NEW papers only. */
export async function saveArxivPapers(papers: ArxivPaper[], runId: number | null, foundVia = "arxiv"): Promise<number[]> {
  if (!papers.length) return [];
  const rows = papers.map((p) => ({
    paper_key: `arxiv:${p.arxiv_id}`,
    arxiv_id: p.arxiv_id,
    doi: p.doi,
    title: p.title,
    abstract: p.abstract,
    authors: p.authors,
    url: p.url,
    categories: p.categories,
    primary_category: p.primary_category,
    published_at: p.published_at || null,
    journal_ref: p.journal_ref,
    arxiv_comment: p.comment,
    code_url: p.code_url,
  }));
  const inserted = await q<{ id: number }>(
    `INSERT INTO papers (paper_key, arxiv_id, doi, title, abstract, authors, url, categories, primary_category,
                         published_at, journal_ref, arxiv_comment, code_url, found_via, run_id, confirm_status)
     SELECT x.paper_key, x.arxiv_id, x.doi, x.title, x.abstract,
            ARRAY(SELECT jsonb_array_elements_text(x.authors)), x.url,
            ARRAY(SELECT jsonb_array_elements_text(x.categories)), x.primary_category,
            x.published_at, x.journal_ref, x.arxiv_comment, x.code_url, $2, $3, 'confirmed'
     FROM jsonb_to_recordset($1::jsonb) AS x(paper_key text, arxiv_id text, doi text, title text, abstract text,
          authors jsonb, url text, categories jsonb, primary_category text, published_at timestamptz,
          journal_ref text, arxiv_comment text, code_url text)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [JSON.stringify(rows), foundVia, runId],
  );
  const ids = inserted.map((r) => r.id);
  await fanOutByCategory(ids);
  return ids;
}

/** A paper belongs (as a candidate) to every active topic whose arXiv categories it is listed in. */
export async function fanOutByCategory(paperIds: number[]): Promise<void> {
  if (!paperIds.length) return;
  await q(
    `INSERT INTO paper_topics (paper_id, topic_id, via)
     SELECT p.id, t.id, 'category' FROM papers p
     JOIN topics t ON t.active AND t.arxiv_categories && p.categories
     WHERE p.id = ANY($1::int[])
     ON CONFLICT DO NOTHING`,
    [paperIds],
  );
}

export async function addPaperTopic(paperId: number, topicId: number, via: string): Promise<void> {
  await q(`INSERT INTO paper_topics (paper_id, topic_id, via) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [paperId, topicId, via]);
}

/**
 * A paper seen on a research site, in a blog, or reported by Kavita, that still needs confirming
 * (arXiv / Semantic Scholar / OpenReview). Returns its id (existing or new).
 */
export async function savePlaceholderPaper(
  link: PaperLink,
  title: string,
  snippet: string,
  foundVia: string,
  runId: number | null,
): Promise<{ id: number; isNew: boolean }> {
  const existing = await findPaperByLink(link);
  if (existing) return { id: existing, isNew: false };
  const key = `${link.kind}:${link.id}`;
  const row = await q1<{ id: number }>(
    `INSERT INTO papers (paper_key, arxiv_id, doi, openreview_id, title, abstract, url, found_via, run_id, confirm_status, clean_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending', 'pending')
     ON CONFLICT DO NOTHING RETURNING id`,
    [
      key,
      link.kind === "arxiv" ? link.id : null,
      link.kind === "doi" ? link.id : null,
      link.kind === "openreview" ? link.id : null,
      title.slice(0, 500) || link.url,
      snippet.slice(0, 2000),
      link.url,
      foundVia,
      runId,
    ],
  );
  if (row) return { id: row.id, isNew: true };
  const again = await findPaperByLink(link);
  if (!again) throw new Error(`could not save paper ${key}`);
  return { id: again, isNew: false };
}

export async function findPaperByLink(link: PaperLink): Promise<number | null> {
  const r = await q1<{ id: number }>(
    `SELECT id FROM papers
     WHERE paper_key = $1
        OR ($2::text IS NOT NULL AND arxiv_id = $2)
        OR ($3::text IS NOT NULL AND doi = $3)
        OR ($4::text IS NOT NULL AND openreview_id = $4)
        OR url = $5 OR $5 = ANY(alt_urls)
     ORDER BY id LIMIT 1`,
    [
      `${link.kind}:${link.id}`,
      link.kind === "arxiv" ? link.id : null,
      link.kind === "doi" ? link.id : null,
      link.kind === "openreview" ? link.id : null,
      link.url,
    ],
  );
  return r?.id ?? null;
}

/**
 * Same paper found twice (e.g. on OpenReview and arXiv): fold `dupId` into `keepId` — topics, blogs,
 * marks and brief items move over, the venue facts are kept, and the duplicate row is removed.
 */
export async function mergePapers(keepId: number, dupId: number): Promise<void> {
  if (keepId === dupId) return;
  await q(
    `INSERT INTO paper_topics (paper_id, topic_id, via, status, relevant, reason, attempts, checked_at)
     SELECT $1, topic_id, via, status, relevant, reason, attempts, checked_at FROM paper_topics WHERE paper_id = $2
     ON CONFLICT DO NOTHING`,
    [keepId, dupId],
  );
  await q(`UPDATE blogs SET linked_paper_id = $1 WHERE linked_paper_id = $2`, [keepId, dupId]);
  await q(`UPDATE marks SET paper_id = $1 WHERE paper_id = $2 AND kind = 'missed'`, [keepId, dupId]);
  await q(
    `INSERT INTO marks (kind, paper_id, brief_item_id, topic_id, created_at)
     SELECT kind, $1, brief_item_id, topic_id, created_at FROM marks WHERE paper_id = $2 AND kind <> 'missed'
     ON CONFLICT DO NOTHING`,
    [keepId, dupId],
  );
  await q(
    `UPDATE papers k SET
       alt_urls = (SELECT ARRAY(SELECT DISTINCT u FROM unnest(k.alt_urls || d.alt_urls || ARRAY[d.url]) u WHERE u <> k.url)),
       venue = COALESCE(k.venue, d.venue),
       doi = COALESCE(k.doi, d.doi),
       openreview_id = COALESCE(k.openreview_id, d.openreview_id),
       pub_status = CASE WHEN d.pub_status = 'peer_reviewed' THEN 'peer_reviewed' ELSE k.pub_status END,
       code_url = COALESCE(k.code_url, d.code_url)
     FROM papers d WHERE k.id = $1 AND d.id = $2`,
    [keepId, dupId],
  );
  // brief_items for the duplicate cascade away with it; the kept paper carries the history.
  await q(`DELETE FROM papers WHERE id = $1`, [dupId]);
}

/** When Kavita adds a topic or changes its categories: queue the last 7 days' papers for that topic. */
export async function backfillTopic(topicId: number): Promise<number> {
  const r = await q(
    `INSERT INTO paper_topics (paper_id, topic_id, via)
     SELECT p.id, t.id, 'category' FROM papers p JOIN topics t ON t.id = $1
     WHERE t.active AND t.arxiv_categories && p.categories AND p.first_seen_at > now() - interval '7 days'
     ON CONFLICT DO NOTHING RETURNING paper_id`,
    [topicId],
  );
  return r.length;
}
