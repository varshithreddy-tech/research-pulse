// Builds the system prompt Gemini reads before every judgment: the four context files plus
// Kavita's live topic list from Neon. The shared prefix is identical for every call, so Gemini's
// implicit prompt caching can reuse it across a run.
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Topic } from "./db";

const cache = new Map<string, string>();

function readContext(file: "importance.md" | "evidence-rules.md" | "brief-format.md"): string {
  let v = cache.get(file);
  if (!v) {
    // Statically scoped path so the bundler traces only the context folder.
    v = readFileSync(path.join(process.cwd(), "context", file), "utf8");
    cache.set(file, v);
  }
  return v;
}

export function topicsContext(topics: Topic[]): string {
  return JSON.stringify(
    topics.map((t) => ({
      topic_id: t.id,
      name: t.name,
      focus: t.focus,
      arxiv_categories: t.arxiv_categories,
      search_words_hint: t.search_words,
    })),
    null,
    1,
  );
}

const PREAMBLE = `You are the research assistant inside "Research Pulse", a weekly AI/ML research brief for Kavita, a senior technology-advisory consultant.
You SUGGEST; Kavita decides. You never hide or drop a paper — every input item must get an answer.
Judge only from the input you are given. Never invent papers, links, IDs, numbers, results or authors.
Never call a paper "validated", "proven", "breakthrough", "groundbreaking" or "state-of-the-art".
Reply with JSON only, in the exact shape requested.`;

/** Full system prompt: preamble + all four context files + this step's instructions. */
export function systemPrompt(topics: Topic[], stepInstructions: string): string {
  return [
    PREAMBLE,
    "\n\n=== CONTEXT 1: topics (Kavita's topic list) ===\n",
    topicsContext(topics),
    "\n\n=== CONTEXT 2: importance.md ===\n",
    readContext("importance.md"),
    "\n\n=== CONTEXT 3: evidence-rules.md ===\n",
    readContext("evidence-rules.md"),
    "\n\n=== CONTEXT 4: brief-format.md ===\n",
    readContext("brief-format.md"),
    "\n\n=== YOUR TASK NOW ===\n",
    stepInstructions,
  ].join("");
}
