// Every number must match: the brief, the email, All papers and Cost & coverage use one definition
// (lib/numbers.ts). Part 1 checks the rules on fixed data. Part 2 runs against a real database when
// DATABASE_URL is set (e.g. the preview database) and checks the latest brief against All papers and
// Cost & coverage for the same week, topic by topic.
import { describe, expect, it } from "vitest";
import { briefNumbers, numberProblems, readMinutes } from "@/lib/numbers";
import type { WindowCounts } from "@/lib/brief";

const topic = (topic_id: number, checked: number, relevant: number) => ({
  topic_id, name: `T${topic_id}`, checked, relevant, not_relevant: checked - relevant, not_assessed: 0, pending: 0, older: 0,
});
const counts = (topics: ReturnType<typeof topic>[], scanned: number, onTopic: number): WindowCounts => ({
  papers_checked: scanned, on_topic: onTopic, older_discussed: 0, topics, blogs_checked: 0, blogs_with_paper: 0, blogs_no_paper: 0, blogs_unchecked: 0, unconfirmed: 0,
});

describe("numbers match (rules)", () => {
  it("'+ N more' = on-topic in the topic − shown there; picked = sum shown; unique totals", () => {
    // 10 unique papers scanned, 6 on-topic; topic 1 has 5 on-topic, topic 2 has 3 (2 papers fit both).
    const n = briefNumbers(counts([topic(1, 8, 5), topic(2, 6, 3)], 10, 6), [{ topic_id: 1 }, { topic_id: 1 }, { topic_id: 2 }]);
    expect(n.topics).toEqual([
      { topic_id: 1, scanned: 8, on_topic: 5, shown: 2, more: 3 },
      { topic_id: 2, scanned: 6, on_topic: 3, shown: 1, more: 2 },
    ]);
    expect(n.picked).toBe(3);
    expect(numberProblems(n)).toEqual([]);
  });

  it("catches numbers that cannot all be true", () => {
    const bad = briefNumbers(counts([topic(1, 8, 5)], 4, 6), [{ topic_id: 1 }]);
    expect(numberProblems(bad)).toEqual(
      expect.arrayContaining([expect.stringMatching(/on-topic 6 > scanned 4/), expect.stringMatching(/scanned, more than the unique total/)]),
    );
    const sumBelow = briefNumbers(counts([topic(1, 5, 2), topic(2, 5, 2)], 10, 6), []);
    expect(numberProblems(sumBelow)).toEqual([expect.stringMatching(/adds to 4, less than the unique total 6/)]);
  });

  it("read time is words / 200, rounded up", () => {
    expect(readMinutes(["word ".repeat(201)])).toBe(2);
    expect(readMinutes([])).toBe(1);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("numbers match (live data: brief = All papers = Cost & coverage)", () => {
  it("latest brief", async () => {
    const { q1 } = await import("@/lib/db");
    const { windowCounts } = await import("@/lib/brief");
    const { paperStatusCounts } = await import("@/lib/numbers");
    const b = await q1<{ id: number; week_start: string; week_end: string; dashboard_json: { version?: number; numbers?: ReturnType<typeof briefNumbers> } }>(
      `SELECT id, week_start, week_end, dashboard_json FROM briefs WHERE status = 'done' AND dashboard_json IS NOT NULL ORDER BY id DESC LIMIT 1`,
    );
    expect(b?.dashboard_json.version).toBe(2);
    const n = b!.dashboard_json.numbers!;
    expect(numberProblems(n)).toEqual([]);

    // Cost & coverage reads windowCounts for the same week.
    const cov = await windowCounts(b!.week_start, b!.week_end);
    expect({ scanned: cov.papers_checked, on_topic: cov.on_topic }).toEqual({ scanned: n.scanned, on_topic: n.on_topic });

    // All papers: totals, then each topic's "+ N more" list.
    const all = await paperStatusCounts(b!.week_start, b!.week_end, null, b!.id);
    expect({ scanned: all.scanned, on_topic: all.on_topic, picked: all.picked }).toEqual({ scanned: n.scanned, on_topic: n.on_topic, picked: n.picked });
    expect(all.on_topic).toBe(all.picked + all.more);
    expect(all.scanned).toBe(all.on_topic + all.notrel + all.na);
    for (const t of n.topics) {
      const c = await paperStatusCounts(b!.week_start, b!.week_end, t.topic_id, b!.id);
      expect({ topic: t.topic_id, scanned: c.scanned, on_topic: c.on_topic, shown: c.picked, more: c.more }).toEqual({
        topic: t.topic_id, scanned: t.scanned, on_topic: t.on_topic, shown: t.shown, more: t.more,
      });
    }
  }, 120_000);
});
