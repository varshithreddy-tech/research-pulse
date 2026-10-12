import { describe, expect, it } from "vitest";
import { finalOrder, selectBrief, type RankRow } from "@/lib/steps/rank";
import { normalizeVerdict, cleanLine } from "@/lib/steps/importance";

const row = (id: number, score: number | null, extra: Partial<RankRow> = {}): RankRow => ({
  id,
  paper_id: id,
  topic_id: 1,
  title: `p${id}`,
  importance_status: score === null ? "not_assessed" : "assessed",
  relevance: "yes",
  type: "new_test",
  score,
  reason_line1: "",
  citations: 0,
  hf_upvotes: 0,
  blog_count: 0,
  code: false,
  pub_status: "preprint",
  older: false,
  ...extra,
});

const pickInBrief = (ordered: RankRow[]) => selectBrief([{ topicId: 1, ordered }]).full;

describe("rank, never hide", () => {
  it("keeps every item, even with no Gemini order", () => {
    const rows = [row(1, 3), row(2, 9), row(3, null), row(4, 6), row(5, null, { importance_status: "skipped", relevance: "not_assessed" })];
    const ordered = finalOrder(rows, null);
    expect(ordered.map((r) => r.id)).toEqual([2, 4, 1, 3, 5]);
    expect(ordered).toHaveLength(rows.length);
  });

  it("follows Gemini's order, ignores unknown or repeated ids, appends what it left out", () => {
    const rows = [row(1, 7), row(2, 9), row(3, 8)];
    expect(finalOrder(rows, [3, 99, 3, 1]).map((r) => r.id)).toEqual([3, 1, 2]);
  });

  it("picks at most 3 papers scoring 5+ per topic; a quiet week picks none", () => {
    const rows = [row(1, 9), row(2, 8), row(3, 7), row(4, 6), row(5, 2)];
    expect([...pickInBrief(finalOrder(rows, null))]).toEqual([1, 2, 3]);
    expect(pickInBrief(finalOrder([row(1, 4), row(2, 3)], null)).size).toBe(0);
  });

  it("breaks ties with attention signals", () => {
    const rows = [row(1, 7, { citations: 1 }), row(2, 7, { citations: 5 })];
    expect(finalOrder(rows, null)[0].id).toBe(2);
  });
});

describe("older papers", () => {
  it("rank below every new paper, even with a higher score", () => {
    const rows = [row(1, 9, { older: true }), row(2, 6), row(3, null)];
    expect(finalOrder(rows, [1, 2]).map((r) => r.id)).toEqual([2, 3, 1]);
  });
  it("are never picked (they stay in All papers, labelled)", () => {
    expect([...pickInBrief(finalOrder([row(1, 9, { older: true }), row(2, 8)], null))]).toEqual([2]);
  });
});

/** n topics × k eligible papers each, scores descending inside a topic. */
const topicsOf = (n: number, k: number, score = (t: number, i: number) => 9 - i) =>
  Array.from({ length: n }, (_, t) => ({
    topicId: t + 1,
    ordered: finalOrder(Array.from({ length: k }, (_, i) => row((t + 1) * 100 + i, score(t, i), { topic_id: t + 1 })), null),
  }));

describe("each paper once, ~18 picked, tiers forced in code", () => {
  it("picks a repeated paper once, under the topic where it ranks highest", () => {
    // Paper 500 is #2 in topic 1 and #1 in topic 2 → home is topic 2.
    const a = [row(1, 9), row(2, 8, { paper_id: 500 }), row(3, 7)];
    const b = [row(11, 9, { paper_id: 500, topic_id: 2 }), row(12, 8, { topic_id: 2 })];
    const sel = selectBrief([{ topicId: 1, ordered: finalOrder(a, null) }, { topicId: 2, ordered: finalOrder(b, null) }]);
    expect(sel.full.has(11)).toBe(true);
    expect(sel.full.has(2)).toBe(false);
    expect([...sel.full].sort((x, y) => x - y)).toEqual([1, 3, 11, 12]);
  });

  it("picks every topic's best first and stops at 18", () => {
    const sel = selectBrief(topicsOf(8, 5));
    expect(sel.full.size).toBe(18);
    for (let t = 1; t <= 8; t++) expect(sel.full.has(t * 100)).toBe(true); // each topic's #1
    for (let t = 1; t <= 8; t++) expect(sel.full.has(t * 100 + 3)).toBe(false); // never a 4th per topic
  });

  it("forces the split: 3 Bring to a client (different topics), up to 8 Read this week, rest Just so you know", () => {
    const sel = selectBrief(topicsOf(8, 5, (t, i) => (t === 0 ? 10 - i : 8 - i)));
    const tiers = [...sel.tier.values()];
    expect(tiers.filter((t) => t === 1)).toHaveLength(3);
    expect(tiers.filter((t) => t === 2)).toHaveLength(8);
    expect(tiers.filter((t) => t === 3)).toHaveLength(7);
    // Topic 1 has the strongest papers, but only one of them can be "Bring to a client".
    const t1 = [...sel.tier].filter(([, t]) => t === 1).map(([id]) => Math.floor(id / 100));
    expect(new Set(t1).size).toBe(3);
    expect(sel.tier.get(100)).toBe(1);
  });

  it("small weeks: fewer than 3 topics still get up to 3 'Bring to a client'", () => {
    const sel = selectBrief(topicsOf(1, 5));
    expect([...sel.tier.values()].filter((t) => t === 1)).toHaveLength(3);
    expect(sel.full.size).toBe(3);
  });
});

describe("Question 2 rules", () => {
  it("nothing_new means score 0 (both ways), and scores are clamped", () => {
    expect(normalizeVerdict("nothing_new", 6)).toEqual({ type: "nothing_new", score: 0 });
    expect(normalizeVerdict("new_test", 0)).toEqual({ type: "nothing_new", score: 0 });
    expect(normalizeVerdict("surprising_result", 14)).toEqual({ type: "surprising_result", score: 10 });
    expect(normalizeVerdict("made_up", 5)).toEqual({ type: "nothing_new", score: 0 });
  });

  it("strips label words: facts, not labels", () => {
    expect(cleanLine("A validated breakthrough in RAG")).not.toMatch(/validated|breakthrough/i);
  });
});
