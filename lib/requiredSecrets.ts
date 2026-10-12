// The app must never run (or deploy) without its two locks. Called from next.config.ts, which runs
// on `next dev`, `next build` (so a Vercel deploy fails) and `next start`.
export const REQUIRED_SECRETS = ["DASHBOARD_PASSWORD", "CRON_SECRET"] as const;

export function assertRequiredSecrets(env: Record<string, string | undefined> = process.env): void {
  const missing = REQUIRED_SECRETS.filter((k) => !env[k]?.trim());
  if (missing.length)
    throw new Error(
      `Research Pulse refuses to start: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} empty. ` +
        `Set ${missing.length > 1 ? "them" : "it"} in .env.local (local) or in Vercel → Project → Settings → Environment Variables.`,
    );
}
