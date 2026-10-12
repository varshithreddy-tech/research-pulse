// "Make brief now" for scripts: curl -X POST -H "Authorization: Bearer $CRON_SECRET" <url>/api/admin/make-brief
import { isCronAuthorized } from "@/lib/auth";
import { launchWeekly } from "@/lib/pipeline/start";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = await launchWeekly("admin", new URL(req.url).origin);
  return Response.json({ ok: true, ...started }, { status: 202 });
}
