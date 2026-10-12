// Topic change log: the dashboard is public, so every topic change is recorded (what changed, when).
import { q } from "./db";

export type TopicFields = { name: string; focus: string; arxiv_categories: string[]; search_words: string[] };

export type Changes = Record<string, { from: unknown; to: unknown }>;

/** Field-by-field difference between two versions of a topic. */
export function topicDiff(before: TopicFields, after: TopicFields): Changes {
  const out: Changes = {};
  for (const k of ["name", "focus", "arxiv_categories", "search_words"] as const) {
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) out[k] = { from: before[k], to: after[k] };
  }
  return out;
}

export async function logTopicChange(topicId: number, topicName: string, action: "created" | "edited" | "paused" | "resumed", changes: Changes): Promise<void> {
  await q(`INSERT INTO topic_changes (topic_id, topic_name, action, changes) VALUES ($1, $2, $3, $4)`, [
    topicId,
    topicName,
    action,
    JSON.stringify(changes),
  ]);
}

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  focus: "focus",
  arxiv_categories: "arXiv categories",
  search_words: "search words",
  active: "active",
};

const show = (v: unknown) => (Array.isArray(v) ? v.join(", ") : v === null || v === undefined ? "—" : String(v));

/** One readable line per changed field, e.g. "focus: “old…” → “new…”". */
export function describeChanges(action: string, changes: Changes): string[] {
  if (action === "paused" || action === "resumed") return [action === "paused" ? "Paused" : "Resumed"];
  return Object.entries(changes).map(([k, v]) =>
    action === "created" ? `${FIELD_LABEL[k] ?? k}: ${show(v.to)}` : `${FIELD_LABEL[k] ?? k}: “${show(v.from)}” → “${show(v.to)}”`,
  );
}
