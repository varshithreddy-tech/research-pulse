import { describe, expect, it } from "vitest";
import { assertRequiredSecrets } from "@/lib/requiredSecrets";
import { isCronAuthorized } from "@/lib/auth";

describe("CRON_SECRET stays required", () => {
  it("refuses to start when CRON_SECRET is empty", () => {
    expect(() => assertRequiredSecrets({})).toThrow(/CRON_SECRET is empty/);
    expect(() => assertRequiredSecrets({ CRON_SECRET: "  " })).toThrow(/CRON_SECRET is empty/);
  });
  it("starts with CRON_SECRET set; no dashboard password needed", () => {
    expect(() => assertRequiredSecrets({ CRON_SECRET: "b" })).not.toThrow();
  });
  it("cron routes accept only the exact bearer secret", () => {
    process.env.CRON_SECRET = "s3cret";
    const req = (h?: string) => new Request("https://x/api/daily", h ? { headers: { authorization: h } } : {});
    expect(isCronAuthorized(req())).toBe(false);
    expect(isCronAuthorized(req("Bearer wrong!"))).toBe(false);
    expect(isCronAuthorized(req("Bearer s3cret"))).toBe(true);
  });
});
