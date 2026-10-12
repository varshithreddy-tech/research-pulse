// Tavily: (a) research sites only, (b) blog posts. Basic search = 1 credit each (1,000 free / month).
import { envOptional } from "../env";

export const RESEARCH_DOMAINS = [
  "openreview.net",
  "aclanthology.org",
  "openaccess.thecvf.com",
  "ieeexplore.ieee.org",
  "dl.acm.org",
];

export interface TavilyResult {
  url: string;
  title: string;
  content: string; // short snippet
  raw_content?: string | null;
  published_date?: string | null;
}

export function tavilyConfigured(): boolean {
  return Boolean(envOptional("TAVILY_API_KEY"));
}

async function search(body: Record<string, unknown>): Promise<TavilyResult[]> {
  const key = envOptional("TAVILY_API_KEY");
  if (!key) throw new Error("TAVILY_API_KEY not set");
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ search_depth: "basic", time_range: "week", topic: "general", ...body }),
    signal: AbortSignal.timeout(45_000),
  });
  const json = (await res.json().catch(() => ({}))) as { results?: TavilyResult[]; detail?: unknown; error?: unknown };
  if (!res.ok) throw new Error(`Tavily ${res.status}: ${JSON.stringify(json.detail ?? json.error ?? "").slice(0, 200)}`);
  return json.results ?? [];
}

function queryFor(name: string, words: string[]): string {
  const w = words.slice(0, 4).join(", ");
  return w ? `${name} (${w})` : name;
}

/** (a) New papers on the five research sites. */
export function searchResearchSites(topicName: string, words: string[]): Promise<TavilyResult[]> {
  return search({ query: `${queryFor(topicName, words)} paper`, include_domains: RESEARCH_DOMAINS, max_results: 10 });
}

/** (b) Blog posts about the topic, with the page text so paper links can be found. */
export function searchBlogs(topicName: string, words: string[]): Promise<TavilyResult[]> {
  return search({
    query: `${queryFor(topicName, words)} research blog post`,
    exclude_domains: [...RESEARCH_DOMAINS, "arxiv.org"],
    include_raw_content: "markdown",
    max_results: 10,
  });
}
