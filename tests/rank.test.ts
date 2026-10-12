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

/** Single-topic selection, as the brief did before cross-topic de-duplication. */
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

  it("puts at most 3 papers scoring 5+ in the brief; a quiet week puts none", () => {
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
  it("only reach the brief when fewer than 3 new papers score 5+", () => {
    const rows = [row(1, 9, { older: true }), row(2, 8), row(3, 7), row(4, 6)];
    expect([...pickInBrief(finalOrder(rows, null))]).toEqual([2, 3, 4]);
    expect([...pickInBrief(finalOrder([row(1, 9, { older: true }), row(2, 8)], null))]).toEqual([2, 1]);
  });
});

describe("each paper in full once per brief", () => {
  it("later topics show a repeat as 'Also relevant here' and fill the slot with their next-best new paper", () => {
    // Paper 100 is top in both topics; topic B has 4 eligible papers.
    const a = [row(1, 9, { paper_id: 100 }), row(2, 8), row(3, 7)];
    const b = [row(11, 9, { paper_id: 100, topic_id: 2 }), row(12, 8), row(13, 7), row(14, 6)];
    const sel = selectBrief([{ topicId: 1, ordered: finalOrder(a, null) }, { topicId: 2, ordered: finalOrder(b, null) }]);
    expect([...sel.full].sort((x, y) => x - y)).toEqual([1, 2, 3, 12, 13, 14]);
    expect(sel.also.get(11)).toBe(1); // shown in full under topic 1
    expect(sel.also.size).toBe(1);
  });
  it("a repeat outside the later topic's top 3 is not listed there", () => {
    const a = [row(1, 9, { paper_id: 100 })];
    const b = [row(11, 9), row(12, 8), row(13, 7), row(14, 6, { paper_id: 100 })];
    const sel = selectBrief([{ topicId: 1, ordered: finalOrder(a, null) }, { topicId: 2, ordered: finalOrder(b, null) }]);
    expect(sel.also.size).toBe(0);
    expect([...sel.full].sort((x, y) => x - y)).toEqual([1, 11, 12, 13]);
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
