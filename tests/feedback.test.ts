import { describe, expect, it } from "vitest";
import { makeMarkToken, verifyMarkToken, TOKEN_TTL_MS } from "@/lib/markToken";
import { capWords } from "@/lib/steps/write";

const SECRET = "test-secret";

describe("one-click feedback links", () => {
  it("round-trips item and mark type", () => {
    const t = makeMarkToken(627, "share", Date.now(), SECRET);
    expect(verifyMarkToken(t, Date.now(), SECRET)).toEqual({ ok: true, itemId: 627, kind: "share" });
  });
  it("expires after 14 days", () => {
    const issued = Date.UTC(2026, 9, 12);
    const t = makeMarkToken(1, "read_fully", issued, SECRET);
    expect(verifyMarkToken(t, issued + TOKEN_TTL_MS - 1000, SECRET).ok).toBe(true);
    expect(verifyMarkToken(t, issued + TOKEN_TTL_MS + 1000, SECRET)).toEqual({ ok: false, reason: "expired" });
  });
  it("rejects tampering: another item, another mark type, another secret", () => {
    const t = makeMarkToken(5, "not_useful", Date.now(), SECRET);
    expect(verifyMarkToken(t.replace(/^5\./, "6."), Date.now(), SECRET).ok).toBe(false);
    expect(verifyMarkToken(t.replace("not_useful", "share"), Date.now(), SECRET).ok).toBe(false);
    expect(verifyMarkToken(t, Date.now(), "other-secret").ok).toBe(false);
    expect(verifyMarkToken("garbage", Date.now(), SECRET).ok).toBe(false);
  });
});

describe("What's changing", () => {
  it("is capped at 25 words", () => {
    const long = Array.from({ length: 40 }, (_, i) => `w${i}`).join(" ");
    expect(capWords(long).split(/\s+/)).toHaveLength(25);
    expect(capWords("Short and plain.")).toBe("Short and plain.");
  });
});
