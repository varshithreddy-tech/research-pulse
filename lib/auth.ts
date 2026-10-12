// Two locks on the door: CRON_SECRET for cron/admin API routes, DASHBOARD_PASSWORD for the dashboard.
// Both are required — next.config.ts refuses to build or start without them (lib/requiredSecrets.ts).
// Uses Web Crypto so it works in proxy.ts as well as in route handlers.

export const SESSION_COOKIE = "rp_session";

async function hmacHex(key: string, message: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cookie value for a logged-in session. Changing DASHBOARD_PASSWORD logs everyone out. */
export async function sessionToken(): Promise<string> {
  const pw = process.env.DASHBOARD_PASSWORD;
  if (!pw) throw new Error("Missing env var DASHBOARD_PASSWORD");
  return hmacHex(pw, "research-pulse-session-v1");
}

export async function isValidSession(cookieValue: string | undefined): Promise<boolean> {
  // No password configured → nobody gets in (fail closed).
  if (!cookieValue || !process.env.DASHBOARD_PASSWORD) return false;
  return safeEqual(cookieValue, await sessionToken());
}

export function isCronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return safeEqual(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
