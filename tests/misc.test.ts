import { describe, expect, it } from "vitest";
import { briefWeek, istWeekStart, weekBounds, weekLabel, arxivDate } from "@/lib/time";
import { titlesMatch, cleanSiteTitle } from "@/lib/steps/confirm";
import { peerReviewAllowed } from "@/lib/steps/clean";
import { emptyTopicSentence, labText, signals, type ItemView } from "@/lib/brief";
import { affiliation } from "@/lib/sources/semanticScholar";
import { isPaperOwnPage } from "@/lib/steps/evidence";

describe("IST weeks", () => {
  it("Monday 00:00 IST is the week start", () => {
    // Monday 12 Oct 2026, 06:30 IST = 01:00 UTC
    expect(istWeekStart(new Date("2026-10-12T01:00:00Z")).toISOString()).toBe("2026-10-11T18:30:00.000Z");
    // Sunday 11 Oct 2026, 23:00 IST belongs to the week of 5 Oct
    expect(istWeekStart(new Date("2026-10-11T17:30:00Z")).toISOString()).toBe("2026-10-04T18:30:00.000Z");
  });
  it("one definition of the week: Monday to Monday IST; the scheduled brief covers the week that just ended", () => {
    const mon = new Date("2026-10-12T01:00:00Z"); // Monday 12 Oct, 06:30 IST
    expect(weekBounds(mon)).toEqual({ start: new Date("2026-10-11T18:30:00Z"), end: new Date("2026-10-18T18:30:00Z") });
    expect(briefWeek(mon, true)).toEqual({ start: new Date("2026-10-04T18:30:00Z"), end: new Date("2026-10-11T18:30:00Z") });
    expect(briefWeek(mon, false)).toEqual(weekBounds(mon)); // the button: this week so far
    const w = briefWeek(mon, true);
    expect(weekLabel(w.start, w.end)).toBe("5–11 Oct 2026");
  });
  it("labels and arXiv dates", () => {
    expect(weekLabel(new Date("2026-10-04T18:30:00Z"), new Date("2026-10-11T18:30:00Z"))).toBe("5–11 Oct 2026");
    expect(arxivDate(new Date("2026-10-12T01:05:00Z"))).toBe("202610120105");
  });
});

describe("confirming papers", () => {
  it("matches titles only when they really match", () => {
    expect(titlesMatch("SWE-bench: Can Language Models Resolve Real-World GitHub Issues?", "SWE-bench: can language models resolve real-world GitHub issues")).toBe(true);
    expect(titlesMatch("Agents for code", "A survey of retrieval-augmented generation")).toBe(false);
    expect(cleanSiteTitle("Deep Thing for Defects | IEEE Journals & Magazine | IEEE Xplore")).toBe("Deep Thing for Defects");
  });
  it("only allows Peer-reviewed when a fact supports it", () => {
    expect(peerReviewAllowed({ doi: null, journal_ref: null, venue: null, found_via: "arxiv" })).toBe(false);
    expect(peerReviewAllowed({ doi: null, journal_ref: null, venue: null, found_via: "openreview" })).toBe(false);
    expect(peerReviewAllowed({ doi: null, journal_ref: null, venue: null, found_via: "acl" })).toBe(true);
    expect(peerReviewAllowed({ doi: "10.1145/1", journal_ref: null, venue: null, found_via: "arxiv" })).toBe(true);
  });
});

describe("blogs are leads", () => {
  it("a publisher's own page is not a blog about the paper", () => {
    const doi = { kind: "doi" as const, id: "10.3389/frobt.2025.1554196", url: "https://doi.org/10.3389/frobt.2025.1554196" };
    expect(isPaperOwnPage("https://www.frontiersin.org/journals/robotics-and-ai/articles/10.3389/frobt.2025.1554196/full", doi)).toBe(true);
    const ax = { kind: "arxiv" as const, id: "2610.07457", url: "https://arxiv.org/abs/2610.07457" };
    expect(isPaperOwnPage("https://www.welcome.ai/content/alignquant-efficient-mixed-precision-quantization-for-llms", ax)).toBe(false);
  });
});

describe("brief text", () => {
  it("a topic with 0 papers is always shown with a reason", () => {
    const base = { topic_id: 1, name: "X", relevant: 0, not_relevant: 0, not_assessed: 0, pending: 0, older: 0 };
    expect(emptyTopicSentence({ ...base, checked: 0 })).toMatch(/No papers were found/);
    expect(emptyTopicSentence({ ...base, checked: 40, not_relevant: 40 })).toMatch(/None of the 40/);
  });
  it("hides empty signals: citations, upvotes and blogs only when above zero", () => {
    const i = { pub_status: "preprint", venue: null, citations: 0, hf_upvotes: null, code_url: null, blog_count: 0 } as unknown as ItemView;
    expect(signals(i)).toEqual([]);
    const j = { ...i, pub_status: "peer_reviewed", venue: "ACL", citations: 3, hf_upvotes: 1, code_url: "https://x", blog_count: 2 } as unknown as ItemView;
    expect(signals(j)).toEqual(["Peer-reviewed (ACL)", "Cited 3 times", "1 upvote on Hugging Face", "Code shared", "2 blogs discussing it"]);
  });
  it("shows the lab from Semantic Scholar, else 'First author et al.', and never invents one", () => {
    expect(labText({ affiliation: "Tsinghua University", first_author: "A. B", author_count: 4 })).toBe("Tsinghua University");
    expect(labText({ affiliation: null, first_author: "Wei Minn", author_count: 4 })).toBe("Wei Minn et al.");
    expect(labText({ affiliation: null, first_author: "Abbas Raftari", author_count: 1 })).toBe("Abbas Raftari");
    expect(labText({ affiliation: null, first_author: null, author_count: 0 })).toBeNull();
    expect(affiliation({ paperId: "x", title: "t", authors: [{ affiliations: [] }, { affiliations: [] }] })).toBeNull();
    expect(affiliation({ paperId: "x", title: "t", authors: [{ affiliations: ["University of Southern California;Sharif University of Technology"] }, { affiliations: ["IBM"] }] }))
      .toBe("University of Southern California · Sharif University of Technology");
  });
});
