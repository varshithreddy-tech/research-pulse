// Vercel Cron, every day 00:30 UTC = 6:00 AM IST. Also receives its own continuations (?run=&hop=).
import { isCronAuthorized } from "@/lib/auth";
import { launchDaily } from "@/lib/pipeline/start";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const run = Number(url.searchParams.get("run"));
  const hop = Number(url.searchParams.get("hop"));
  const started = await launchDaily("cron", url.origin, run ? { runId: run, hop: hop || 0 } : undefined);
  return Response.json({ ok: true, ...started }, { status: 202 });
}
