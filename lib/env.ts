// Env access in one place. Throws a clear error when a required secret is missing.

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name}`);
  return v;
}

export function envOptional(name: string): string | undefined {
  return process.env[name] || undefined;
}

export function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const v = Number(raw);
  return raw !== undefined && raw !== "" && Number.isFinite(v) ? v : fallback;
}

/** Public dashboard URL: used for links in the email and for chaining long runs. */
export function appUrl(fallback = "http://localhost:3000"): string {
  return (
    envOptional("APP_URL")?.replace(/\/$/, "") ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : fallback)
  );
}
