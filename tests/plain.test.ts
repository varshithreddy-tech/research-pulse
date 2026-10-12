import { describe, expect, it } from "vitest";
import { dehype } from "@/lib/plain";

describe("plain English safety net", () => {
  it("removes hype words and keeps the sentence readable", () => {
    expect(dehype("It signals a critical risk for teams.")).toBe("It signals a risk for teams.");
    expect(dehype("A groundbreaking, validated result.")).toBe("A result."); // label words go too
    expect(dehype("This is an unprecedented gain.")).toBe("This is a gain.");
    expect(dehype("Shows a deeply flawed benchmark")).toBe("Shows a flawed benchmark");
  });
  it("leaves plain text alone", () => {
    expect(dehype("Coding agents miss bugs in large company code.")).toBe("Coding agents miss bugs in large company code.");
  });
});
