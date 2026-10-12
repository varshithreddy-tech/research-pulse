// Semantic Scholar: confirms papers exist, and gives reaction numbers (citations, venue, authors).
// Unauthenticated access shares a small rate limit, so requests are spaced and 429s retried.
import { envOptional } from "../env";
import { sleep } from "../time";

const API = "https://api.semanticscholar.org/graph/v1";
export const S2_FIELDS =
  "title,abstract,url,year,venue,publicationVenue,externalIds,citationCount,influentialCitationCount,authors.name,authors.hIndex,authors.paperCount,journal,publicationDate";

export interface S2Paper {
  paperId: string;
  title: string;
  abstract?: string | null;
  url?: string;
  year?: number | null;
  venue?: string | null;
  publicationVenue?: { name?: string; type?: string } | null;
  externalIds?: { ArXiv?: string; DOI?: string; ACL?: string; DBLP?: string } | null;
  citationCount?: number | null;
  influentialCitationCount?: number | null;
  authors?: { name?: string; hIndex?: number | null; paperCount?: number | null }[];
  journal?: { name?: string } | null;
  publicationDate?: string | null;
}

let lastAt = 0;
let queue: Promise<unknown> = Promise.resolve();

/** One Semantic Scholar request at a time, spaced to stay under the rate limit. */
function s2Fetch(path: string, init: RequestInit = {}, attempts = 7): Promise<Response> {
  const run = queue.then(() => doFetch(path, init, attempts));
  queue = run.catch(() => undefined);
  return run;
}

async function doFetch(path: string, init: RequestInit, attempts: number): Promise<Response> {
  const key = envOptional("SEMANTIC_SCHOLAR_API_KEY");
  const gap = key ? 1100 : 1500;
  // The shared unauthenticated pool returns 429 at random, so back off (7 attempts ≈ 2 min in total).
  for (let attempt = 0; attempt < attempts; attempt++) {
    const wait = lastAt + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastAt = Date.now();
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: { "content-type": "application/json", ...(key ? { "x-api-key": key } : {}), ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status !== 429 && res.status < 500) return res;
    if (attempt + 1 < attempts) await sleep(Math.min(30_000, 2000 * 2 ** attempt));
  }
  throw new Error("Semantic Scholar rate-limited or unavailable");
}

/** Batch lookup. ids like "ARXIV:2410.01234", "DOI:10.1145/...", "ACL:2024.acl-long.1". Returns aligned array (null = not found). */
export async function s2Batch(ids: string[], attempts = 7): Promise<(S2Paper | null)[]> {
  const out: (S2Paper | null)[] = [];
  for (let i = 0; i < ids.length; i += 400) {
    const batch = ids.slice(i, i + 400);
    const res = await s2Fetch(`/paper/batch?fields=${S2_FIELDS}`, { method: "POST", body: JSON.stringify({ ids: batch }) }, attempts);
    if (!res.ok) throw new Error(`Semantic Scholar batch ${res.status}`);
    out.push(...((await res.json()) as (S2Paper | null)[]));
  }
  return out;
}

/** Best title match, or null. */
export async function s2MatchTitle(title: string, attempts = 7): Promise<S2Paper | null> {
  const res = await s2Fetch(`/paper/search/match?query=${encodeURIComponent(title.slice(0, 300))}&fields=${S2_FIELDS}`, {}, attempts);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Semantic Scholar match ${res.status}`);
  const json = (await res.json()) as { data?: S2Paper[] };
  return json.data?.[0] ?? null;
}

/** A real conference/journal venue (not arXiv itself). */
export function s2Venue(p: S2Paper | null): string | null {
  if (!p) return null;
  const v = (p.publicationVenue?.name || p.venue || p.journal?.name || "").trim();
  if (!v || /arxiv/i.test(v)) return null;
  return v;
}

/** "Lead author h-index 12 · 40 papers" — facts about the authors' past work. */
export function authorInfo(p: S2Paper | null): string | null {
  const authors = (p?.authors ?? []).filter((a) => typeof a.hIndex === "number");
  if (!authors.length) return null;
  const top = authors.reduce((a, b) => ((b.hIndex ?? 0) > (a.hIndex ?? 0) ? b : a));
  return `Most-cited author: ${top.name} (h-index ${top.hIndex}, ${top.paperCount ?? "?"} papers)`;
}
