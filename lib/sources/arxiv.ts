// arXiv API: the complete list. Fetched by CATEGORY ONLY (never by keyword), so a paper that
// doesn't use Kavita's words still reaches the relevance check. One request at a time, ~3 s apart.
import { XMLParser } from "fast-xml-parser";
import { arxivDate, sleep } from "../time";
import { arxivUrl, bareArxivId, findCodeUrl, publisherDoi } from "../ids";

const API = "https://export.arxiv.org/api/query";
const GAP_MS = 3100;
const PAGE_SIZE = 200;

export interface ArxivPaper {
  arxiv_id: string;
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  published_at: string; // first version submitted
  categories: string[];
  primary_category: string | null;
  doi: string | null;
  journal_ref: string | null;
  comment: string | null;
  code_url: string | null;
}

let lastRequestAt = 0;

let queue: Promise<unknown> = Promise.resolve();

/** One arXiv request at a time, even when parallel batches ask at once. */
function politeGet(url: string): Promise<string> {
  const run = queue.then(() => doGet(url));
  queue = run.catch(() => undefined);
  return run;
}

async function doGet(url: string): Promise<string> {
  const wait = lastRequestAt + GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  let lastErr = "";
  for (let attempt = 0; attempt < 3; attempt++) {
    lastRequestAt = Date.now();
    try {
      const res = await fetch(url, {
        headers: { "user-agent": "ResearchPulse/1.0 (weekly research brief; contact via project repo)" },
        signal: AbortSignal.timeout(45_000),
      });
      if (res.ok) return await res.text();
      lastErr = `arXiv HTTP ${res.status}`;
    } catch (e) {
      lastErr = `arXiv network: ${String(e)}`;
    }
    await sleep(GAP_MS * (attempt + 2));
  }
  throw new Error(lastErr);
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  isArray: (name) => ["entry", "author", "category", "link"].includes(name),
  removeNSPrefix: true,
});

const squash = (s: unknown) => String(s ?? "").replace(/\s+/g, " ").trim();

function toPaper(e: Record<string, unknown>): ArxivPaper | null {
  const idUrl = squash(e.id);
  const m = idUrl.match(/arxiv\.org\/abs\/(.+)$/);
  if (!m) return null; // arXiv error entries have no abs URL
  const arxiv_id = bareArxivId(m[1]);
  const abstract = squash(e.summary);
  const comment = e.comment ? squash(e.comment) : null;
  const cats = ((e.category as Record<string, string>[] | undefined) ?? []).map((c) => c["@_term"]).filter(Boolean);
  const primary = (e.primary_category as Record<string, string> | undefined)?.["@_term"] ?? cats[0] ?? null;
  const doi = publisherDoi(e.doi ? squash(e.doi) : null);
  return {
    arxiv_id,
    title: squash(e.title),
    abstract,
    authors: ((e.author as Record<string, unknown>[] | undefined) ?? []).map((a) => squash(a.name)).filter(Boolean),
    url: arxivUrl(arxiv_id),
    published_at: squash(e.published),
    categories: Array.from(new Set(cats)),
    primary_category: primary,
    doi,
    journal_ref: e.journal_ref ? squash(e.journal_ref) : null,
    comment,
    code_url: findCodeUrl(`${comment ?? ""} ${abstract}`),
  };
}

function parseFeed(xml: string): { total: number; papers: ArxivPaper[] } {
  const doc = parser.parse(xml) as { feed?: Record<string, unknown> };
  const feed = doc.feed ?? {};
  const total = Number(feed.totalResults ?? 0) || 0;
  const entries = (feed.entry as Record<string, unknown>[] | undefined) ?? [];
  return { total, papers: entries.map(toPaper).filter((p): p is ArxivPaper => p !== null) };
}

/**
 * Every paper in `category` submitted between `from` and `to`, newest first, page by page.
 * `onPage` saves each page as it arrives. Stops early (complete=false) if `deadline` passes.
 */
export async function fetchCategory(
  category: string,
  from: Date,
  to: Date,
  deadline: number,
  onPage: (papers: ArxivPaper[]) => Promise<void>,
): Promise<{ fetched: number; pages: number; total: number; complete: boolean }> {
  const query = `cat:${category} AND submittedDate:[${arxivDate(from)} TO ${arxivDate(to)}]`;
  let start = 0;
  let total = Infinity;
  let pages = 0;
  let fetched = 0;
  while (start < total) {
    if (Date.now() > deadline) return { fetched, pages, total: Number.isFinite(total) ? total : 0, complete: false };
    const url = `${API}?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${PAGE_SIZE}`;
    const page = parseFeed(await politeGet(url));
    pages++;
    total = page.total;
    if (page.papers.length === 0) break;
    fetched += page.papers.length;
    await onPage(page.papers);
    start += PAGE_SIZE;
  }
  return { fetched, pages, total: Number.isFinite(total) ? total : 0, complete: true };
}

/** Looks up specific arXiv IDs (used to confirm papers that blogs and research sites point to). */
export async function fetchByIds(ids: string[]): Promise<ArxivPaper[]> {
  const out: ArxivPaper[] = [];
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    const xml = await politeGet(`${API}?id_list=${batch.join(",")}&max_results=${batch.length}`);
    out.push(...parseFeed(xml).papers);
  }
  return out;
}
