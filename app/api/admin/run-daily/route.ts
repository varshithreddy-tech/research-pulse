// "Run daily now" for scripts: curl -X POST -H "Authorization: Bearer $CRON_SECRET" <url>/api/admin/run-daily
import { isCronAuthorized } from "@/lib/auth";
import { launchDaily } from "@/lib/pipeline/start";

export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return Response.json({ error: "unauthorized" }, { status: 401 });
  const started = await launchDaily("admin", new URL(req.url).origin);
  return Response.json({ ok: true, ...started }, { status: 202 });
}
