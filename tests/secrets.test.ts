import { describe, expect, it } from "vitest";
import { assertRequiredSecrets } from "@/lib/requiredSecrets";

describe("never run unlocked", () => {
  it("refuses when DASHBOARD_PASSWORD or CRON_SECRET is empty", () => {
    expect(() => assertRequiredSecrets({ CRON_SECRET: "x" })).toThrow(/DASHBOARD_PASSWORD is empty/);
    expect(() => assertRequiredSecrets({ DASHBOARD_PASSWORD: "x", CRON_SECRET: "  " })).toThrow(/CRON_SECRET is empty/);
    expect(() => assertRequiredSecrets({})).toThrow(/DASHBOARD_PASSWORD and CRON_SECRET are empty/);
  });
  it("starts when both are set", () => {
    expect(() => assertRequiredSecrets({ DASHBOARD_PASSWORD: "a", CRON_SECRET: "b" })).not.toThrow();
  });
});
