// One-page summary for a client / mandate tag, as Markdown (to paste into a deck or notes).
import { shortlistRows, toMarkdown } from "@/lib/shortlist";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tag = new URL(req.url).searchParams.get("tag")?.trim() || null;
  const rows = await shortlistRows(tag);
  const date = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
  const name = `research-pulse-${(tag ?? "shortlist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shortlist"}.md`;
  return new Response(toMarkdown(tag, rows, date), {
    headers: { "content-type": "text/markdown; charset=utf-8", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
