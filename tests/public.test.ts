import { describe, expect, it } from "vitest";
import { blockedMessage, decideStart, DAILY_CAPS } from "@/lib/runGuard";
import { describeChanges, topicDiff } from "@/lib/topicLog";

const running = { runId: 7, briefId: null, startedAt: "2026-10-12T12:37:00Z" }; // 18:07 IST

describe("public run buttons", () => {
  it("never starts a second run of the same kind; points to the live one", () => {
    const d = decideStart("daily", running, 0);
    expect(d).toEqual({ ok: false, reason: "busy", run: running });
    const m = blockedMessage("daily", d as Exclude<typeof d, { ok: true }>);
    expect(m.msg).toBe("A run is already in progress — started at 18:07 IST.");
    expect(m.link).toBe("/coverage#run-7");
  });
  it("points a busy brief to its own page", () => {
    const d = decideStart("weekly", { ...running, briefId: 3 }, 0) as Exclude<ReturnType<typeof decideStart>, { ok: true }>;
    expect(blockedMessage("weekly", d).link).toBe("/?brief=3");
  });
  it("caps button runs per IST day: daily 6, brief 3 — no waiting period below the cap", () => {
    expect(DAILY_CAPS).toEqual({ daily: 6, weekly: 3 });
    expect(decideStart("daily", null, 5)).toEqual({ ok: true });
    expect(decideStart("daily", null, 6)).toMatchObject({ ok: false, reason: "cap" });
    expect(decideStart("weekly", null, 2)).toEqual({ ok: true });
    const d = decideStart("weekly", null, 3) as Exclude<ReturnType<typeof decideStart>, { ok: true }>;
    expect(blockedMessage("weekly", d).msg).toMatch(/^Daily limit reached/);
    const dd = decideStart("daily", null, 6) as Exclude<ReturnType<typeof decideStart>, { ok: true }>;
    expect(blockedMessage("daily", dd).msg).toBe("Daily limit reached — the scheduled run happens at 6:00 AM IST.");
  });
});

describe("topic change log", () => {
  const before = { name: "CV", focus: "old focus", arxiv_categories: ["cs.CV"], search_words: ["a"] };
  it("records only the fields that changed, with from → to", () => {
    const after = { ...before, focus: "new focus", arxiv_categories: ["cs.CV", "eess.IV"] };
    expect(topicDiff(before, after)).toEqual({
      focus: { from: "old focus", to: "new focus" },
      arxiv_categories: { from: ["cs.CV"], to: ["cs.CV", "eess.IV"] },
    });
    expect(topicDiff(before, before)).toEqual({});
  });
  it("reads as plain lines", () => {
    expect(describeChanges("edited", { focus: { from: "a", to: "b" } })).toEqual(["focus: “a” → “b”"]);
    expect(describeChanges("paused", { active: { from: true, to: false } })).toEqual(["Paused"]);
  });
});
