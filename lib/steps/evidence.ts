// Daily 4 — Evidence check. Blogs are leads; papers are evidence.
// Code finds the paper links in each blog and confirms each paper exists (arXiv / Semantic Scholar).
// Gemini then decides which confirmed paper (if any) the blog is actually about.
// The paper becomes the item; the blog is shown under it as "Discussed in". No paper → saved + counted.
import { q } from "../db";
import { systemPrompt } from "../context";
import { geminiJson, resultsArray, S, type UsageCtx } from "../gemini";
import { addPaperTopic, findPaperByLink, saveArxivPapers, savePlaceholderPaper } from "../papers";
import { classifyUrl, linkKey, type PaperLink } from "../ids";
import { fetchByIds, type ArxivPaper } from "../sources/arxiv";
import { s2Batch, type S2Paper } from "../sources/semanticScholar";
import type { Topic } from "../db";
import { drain, type DrainResult } from "./drain";

interface BlogRow {
  id: number;
  url: string;
  title: string;
  snippet: string;
  topic_id: number | null;
  candidate_links: string[];
  attempts: number;
}

interface Candidate {
  key: string;
  title: string;
  link: PaperLink;
  paperId?: number; // already in Neon
  arxiv?: ArxivPaper;
  s2?: S2Paper;
}

const INSTRUCTIONS = `STEP: EVIDENCE CHECK on blog posts (evidence-rules.md).
Each blog comes with "candidates": papers it links to that have been CONFIRMED to exist.
For EVERY blog decide which ONE candidate the blog is mainly about, or null if it only cites papers in passing
(reading lists, footnotes, "see also") or is about something else.
Only use keys from that blog's own candidates list. Never invent a key.
Return {"results": [{"bid", "linked_key", "reason"}]} — linked_key is a candidate key or null; reason is one short line.`;

const SCHEMA = S.obj({
  results: S.arr(S.obj({ bid: S.int(), linked_key: S.str({ nullable: true }), reason: S.str() })),
});

/** Confirms every candidate link across a batch of blogs. Returns key → candidate for confirmed ones. */
async function confirmCandidates(links: PaperLink[]): Promise<{ confirmed: Map<string, Candidate>; sourceDown: boolean }> {
  const confirmed = new Map<string, Candidate>();
  let sourceDown = false;
  const unknown: PaperLink[] = [];
  for (const l of links) {
    const id = await findPaperByLink(l);
    if (id) {
      const [p] = await q<{ title: string; confirm_status: string }>(`SELECT title, confirm_status FROM papers WHERE id = $1`, [id]);
      if (p?.confirm_status === "confirmed") confirmed.set(linkKey(l), { key: linkKey(l), title: p.title, link: l, paperId: id });
      else unknown.push(l);
    } else unknown.push(l);
  }
  const ax = unknown.filter((l) => l.kind === "arxiv");
  if (ax.length) {
    try {
      for (const a of await fetchByIds(ax.map((l) => l.id))) {
        const l = ax.find((x) => x.id === a.arxiv_id);
        if (l) confirmed.set(linkKey(l), { key: linkKey(l), title: a.title, link: l, arxiv: a });
      }
    } catch {
      sourceDown = true;
    }
  }
  const s2able = unknown.filter((l) => l.kind === "doi" || l.kind === "acl");
  if (s2able.length) {
    try {
      const res = await s2Batch(s2able.map((l) => (l.kind === "doi" ? `DOI:${l.id}` : `ACL:${l.id}`)));
      s2able.forEach((l, i) => {
        const s = res[i];
        if (s?.title) confirmed.set(linkKey(l), { key: linkKey(l), title: s.title, link: l, s2: s });
      });
    } catch {
      sourceDown = true;
    }
  }
  // OpenReview / CVF / IEEE links in blogs carry no title to match on, so they stay "link not confirmed".
  return { confirmed, sourceDown };
}

/** Puts the chosen paper in Neon (if new) and returns its id. */
async function ensurePaper(c: Candidate, runId: number | null): Promise<number> {
  if (c.paperId) return c.paperId;
  if (c.arxiv) {
    await saveArxivPapers([c.arxiv], runId, "blog");
    const id = await findPaperByLink(c.link);
    if (id) return id;
  }
  // Confirmed in Semantic Scholar but not yet stored: save it; the confirm step fills in the details.
  const { id } = await savePlaceholderPaper(c.link, c.title, c.s2?.abstract ?? "", "blog", runId);
  return id;
}

async function handle(blogs: BlogRow[], topics: Topic[], ctx: UsageCtx): Promise<void> {
  const linksByBlog = new Map(
    blogs.map((b) => [b.id, b.candidate_links.map((u) => classifyUrl(u)).filter((l): l is PaperLink => l !== null)]),
  );
  const all = [...new Map([...linksByBlog.values()].flat().map((l) => [linkKey(l), l])).values()];
  const { confirmed, sourceDown } = await confirmCandidates(all);

  const forGemini: { blog: BlogRow; cands: Candidate[] }[] = [];
  for (const b of blogs) {
    const links = linksByBlog.get(b.id) ?? [];
    const cands = links.map((l) => confirmed.get(linkKey(l))).filter((c): c is Candidate => Boolean(c));
    if (cands.length) {
      forGemini.push({ blog: b, cands });
      continue;
    }
    if (!links.length) {
      await setBlog(b.id, "no_paper", null, null, "No link to a published paper found in the post");
    } else if (sourceDown && b.attempts < 2) {
      await q(`UPDATE blogs SET attempts = attempts + 1 WHERE id = $1`, [b.id]);
    } else {
      await setBlog(b.id, "link_not_confirmed", null, null, "Paper link(s) could not be confirmed on arXiv or Semantic Scholar");
    }
  }
  if (!forGemini.length) return;

  const res = await geminiJson({
    step: "evidence",
    system: systemPrompt(topics, INSTRUCTIONS),
    user: JSON.stringify({
      blogs: forGemini.map(({ blog, cands }) => ({
        bid: blog.id,
        title: blog.title,
        url: blog.url,
        excerpt: blog.snippet.slice(0, 900),
        candidates: cands.map((c) => ({ key: c.key, title: c.title })),
      })),
    }),
    schema: SCHEMA,
    items: forGemini.length,
    ctx,
    validate: (o) => resultsArray(o),
  });
  const answers = new Map(res.ok ? res.data.map((r) => [Number(r.bid), r]) : []);

  for (const { blog, cands } of forGemini) {
    const a = answers.get(blog.id);
    if (!a) {
      if (blog.attempts + 1 >= 2) await setBlog(blog.id, "not_assessed", null, null, "Not assessed: the AI check failed");
      else await q(`UPDATE blogs SET attempts = attempts + 1 WHERE id = $1`, [blog.id]);
      continue;
    }
    const chosen = typeof a.linked_key === "string" ? cands.find((c) => c.key === a.linked_key) : undefined;
    const reason = String(a.reason ?? "").slice(0, 300);
    if (!chosen) {
      await setBlog(blog.id, "no_paper", null, null, reason || "Blog is not mainly about a confirmed paper");
      continue;
    }
    const paperId = await ensurePaper(chosen, ctx.runId ?? null);
    if (blog.topic_id) await addPaperTopic(paperId, blog.topic_id, "blog");
    if (isPaperOwnPage(blog.url, chosen.link)) {
      // The "blog" is the publisher's page for the paper itself: keep the paper, but it is not a
      // blog discussing it, so it must not appear as "Discussed in" or count as attention.
      await setBlog(blog.id, "no_paper", null, chosen.link.url, "This page is the paper itself (publisher page), not a blog post about it");
      continue;
    }
    await setBlog(blog.id, "paper_confirmed", paperId, chosen.link.url, reason);
  }
}

/** True when the page URL is the paper's own page (its link, or its DOI appears in the URL). */
export function isPaperOwnPage(pageUrl: string, link: PaperLink): boolean {
  const own = classifyUrl(pageUrl);
  if (own && own.kind === link.kind && own.id === link.id) return true;
  const u = decodeURIComponent(pageUrl).toLowerCase();
  return link.kind === "doi" && u.includes(link.id.toLowerCase());
}

async function setBlog(id: number, status: string, paperId: number | null, link: string | null, reason: string): Promise<void> {
  await q(
    `UPDATE blogs SET evidence_status = $2, linked_paper_id = $3, link_found = $4, reason = $5, attempts = attempts + 1 WHERE id = $1`,
    [id, status, paperId, link, reason],
  );
}

export function evidencePending(topics: Topic[], ctx: UsageCtx, deadline: number): Promise<DrainResult> {
  return drain<BlogRow>({
    load: (limit) =>
      q<BlogRow>(
        `SELECT id, url, title, snippet, topic_id, candidate_links, attempts FROM blogs
         WHERE evidence_status = 'pending' ORDER BY id LIMIT $1`,
        [limit],
      ),
    batchSize: 8,
    deadline,
    handle: (b) => handle(b, topics, ctx),
  });
}
