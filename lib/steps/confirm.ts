// Confirms that papers found on research sites, in blogs or via "You missed this" really exist —
// checked against arXiv or Semantic Scholar. Same paper already known (e.g. OpenReview copy of an
// arXiv paper) → merged into one record. No Gemini here: existence is a fact, not a judgment.
import { q } from "../db";
import { normalizeTitle, publisherDoi } from "../ids";
import { fanOutByCategory, mergePapers } from "../papers";
import { fetchByIds, type ArxivPaper } from "../sources/arxiv";
import { s2Batch, s2MatchTitle, s2Venue, type S2Paper } from "../sources/semanticScholar";

interface PendingPaper {
  id: number;
  paper_key: string;
  arxiv_id: string | null;
  doi: string | null;
  title: string;
  abstract: string; // for research-site pages: the Tavily snippet (often contains the DOI)
  url: string;
  found_via: string;
  confirm_attempts: number;
}

const PEER_REVIEWED_SITES = new Set(["acl", "cvf", "ieee", "acm"]);

/** Strip site suffixes Tavily keeps in page titles ("… | IEEE Xplore", "… - ACL Anthology"). */
export function cleanSiteTitle(t: string): string {
  return t
    .replace(/\s+[|–-]\s+(IEEE|ACL Anthology|OpenReview|ACM|CVF).*$/i, "")
    .replace(/^\s*(OpenReview|PDF)\s*[:|-]\s*/i, "")
    .trim();
}

export function titlesMatch(a: string, b: string): boolean {
  const A = new Set(normalizeTitle(a).split(" ").filter(Boolean));
  const B = new Set(normalizeTitle(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return false;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter) >= 0.8;
}

/** Not found twice → "unconfirmed" (kept and shown, never used as evidence). */
async function markNotFound(p: PendingPaper): Promise<void> {
  await q(
    `UPDATE papers SET confirm_attempts = confirm_attempts + 1,
       confirm_status = CASE WHEN confirm_attempts + 1 >= 2 THEN 'unconfirmed' ELSE 'pending' END
     WHERE id = $1`,
    [p.id],
  );
}

async function applyArxiv(p: PendingPaper, a: ArxivPaper, extra: { venue?: string | null; doi?: string | null; peer?: boolean }): Promise<void> {
  const existing = await q<{ id: number }>(`SELECT id FROM papers WHERE arxiv_id = $1 AND id <> $2`, [a.arxiv_id, p.id]);
  if (existing.length) {
    await mergePapers(existing[0].id, p.id);
    if (extra.venue || extra.peer)
      await q(`UPDATE papers SET venue = COALESCE(venue, $2), pub_status = 'peer_reviewed' WHERE id = $1`, [existing[0].id, extra.venue ?? null]);
    return;
  }
  const doi = extra.doi ?? a.doi;
  await q(
    `UPDATE papers SET paper_key = $2, arxiv_id = $3, title = $4, abstract = $5, authors = $6, categories = $7,
       primary_category = $8, published_at = $9, journal_ref = $10, arxiv_comment = $11, code_url = COALESCE(code_url, $12),
       doi = COALESCE($13, doi), venue = COALESCE($14, venue),
       alt_urls = CASE WHEN url <> $15 THEN array_append(alt_urls, url) ELSE alt_urls END, url = $15,
       pub_status = CASE WHEN $16 OR $13::text IS NOT NULL THEN 'peer_reviewed' ELSE pub_status END,
       confirm_status = 'confirmed'
     WHERE id = $1`,
    [p.id, `arxiv:${a.arxiv_id}`, a.arxiv_id, a.title, a.abstract, a.authors, a.categories, a.primary_category,
     a.published_at || null, a.journal_ref, a.comment, a.code_url, doi, extra.venue ?? null, a.url, Boolean(extra.peer)],
  );
  await fanOutByCategory([p.id]);
}

async function applyS2(p: PendingPaper, s: S2Paper): Promise<void> {
  const venue = s2Venue(s);
  const doi = publisherDoi(s.externalIds?.DOI);
  const peer = Boolean(venue) || Boolean(doi) || PEER_REVIEWED_SITES.has(p.found_via);
  const arx = s.externalIds?.ArXiv;
  if (arx) {
    const [a] = await fetchByIds([arx]);
    if (a) return applyArxiv(p, a, { venue, doi, peer });
  }
  if (doi) {
    const same = await q<{ id: number }>(`SELECT id FROM papers WHERE doi = $1 AND id <> $2 ORDER BY id LIMIT 1`, [doi, p.id]);
    if (same.length) {
      await mergePapers(same[0].id, p.id);
      return;
    }
  }
  await q(
    `UPDATE papers SET title = $2, abstract = CASE WHEN $3::text <> '' THEN $3 ELSE abstract END, authors = $4,
       doi = COALESCE($5, doi), venue = COALESCE($6, venue), published_at = COALESCE($7::timestamptz, published_at),
       pub_status = $8, confirm_status = 'confirmed'
     WHERE id = $1`,
    [p.id, s.title || p.title, s.abstract ?? "", (s.authors ?? []).map((x) => x.name ?? "").filter(Boolean), doi, venue,
     s.publicationDate || null, peer ? "peer_reviewed" : "preprint"],
  );
}

// A source being down is not "not found": the paper just stays "pending" (shown as "Confirming…")
// and is retried on the next run. Lookups retry 3 times here so one slow source can't stall a run.
const S2_ATTEMPTS = 3;

/** Confirms up to `limit` pending papers before `deadline`. Returns how many were settled. */
export async function confirmPending(limit: number, deadline: number): Promise<number> {
  let settled = 0;
  const pending = await q<PendingPaper>(
    `SELECT id, paper_key, arxiv_id, doi, title, abstract, url, found_via, confirm_attempts FROM papers
     WHERE confirm_status = 'pending' ORDER BY id LIMIT $1`,
    [limit],
  );
  if (!pending.length) return 0;

  // 1. arXiv IDs → arXiv API (one request for all).
  const ax = pending.filter((p) => p.paper_key.startsWith("arxiv:"));
  if (ax.length) {
    try {
      const found = new Map((await fetchByIds(ax.map((p) => p.paper_key.slice(6)))).map((a) => [a.arxiv_id, a]));
      for (const p of ax) {
        const a = found.get(p.paper_key.slice(6));
        if (a) await applyArxiv(p, a, {});
        else await markNotFound(p);
        settled++;
      }
    } catch {
      // arXiv down: leave them pending.
    }
  }

  // 2. Everything with an ID → ONE Semantic Scholar batch request: DOIs, ACL IDs, and DOIs printed in
  //    the snippet of IEEE / CVF / OpenReview pages (Tavily snippets often carry "DOI: 10.…").
  const idOf = (p: PendingPaper): string | null => {
    if (p.paper_key.startsWith("doi:")) return `DOI:${p.paper_key.slice(4)}`;
    if (p.paper_key.startsWith("acl:")) return `ACL:${p.paper_key.slice(4)}`;
    const d = publisherDoi(p.abstract.match(/\b(10\.\d{4,9}\/[^\s"'<>)\]},;]+)/)?.[1]);
    return d ? `DOI:${d}` : null;
  };
  const byId = pending.filter((p) => !ax.includes(p) && idOf(p) !== null);
  if (byId.length) {
    try {
      const ids = byId.map((p) => idOf(p)!);
      const res = await s2Batch(ids, S2_ATTEMPTS);
      for (const [i, p] of byId.entries()) {
        const s = res[i];
        if (s) await applyS2(p, s);
        else await markNotFound(p);
        settled++;
      }
    } catch {
      // Semantic Scholar down: leave them pending.
    }
  }

  // 3. Pages with no ID at all (OpenReview, CVF, most IEEE) → title match. Semantic Scholar has no
  //    batch endpoint for titles, so this is one request each, inside the confirm time cap.
  const byTitle = pending.filter((p) => !ax.includes(p) && !byId.includes(p));
  for (const p of byTitle) {
    if (Date.now() > deadline) break;
    const title = cleanSiteTitle(p.title);
    if (!title || /^https?:/.test(title)) {
      await markNotFound(p);
      settled++;
      continue;
    }
    try {
      const s = await s2MatchTitle(title, S2_ATTEMPTS);
      if (s && titlesMatch(s.title, title)) await applyS2(p, s);
      else await markNotFound(p);
      settled++;
    } catch {
      break; // Semantic Scholar is rate-limiting: stop for now, the rest stay pending.
    }
  }
  return settled;
}
