// Vercel Cron, every Monday 01:00 UTC = 6:30 AM IST. Also receives its own continuations (?run=&brief=&hop=).
import { isCronAuthorized } from "@/lib/auth";
import { launchWeekly } from "@/lib/pipeline/start";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const run = Number(url.searchParams.get("run"));
  const brief = Number(url.searchParams.get("brief"));
  const hop = Number(url.searchParams.get("hop"));
  const started = await launchWeekly("cron", url.origin, run && brief ? { runId: run, briefId: brief, hop: hop || 0 } : undefined);
  return Response.json({ ok: true, ...started }, { status: 202 });
}
