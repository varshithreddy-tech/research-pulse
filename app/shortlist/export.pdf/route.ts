// One-page summary for a client / mandate tag, as a PDF download.
import { shortlistRows, toPdf } from "@/lib/shortlist";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const tag = new URL(req.url).searchParams.get("tag")?.trim() || null;
  const rows = await shortlistRows(tag);
  const date = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
  const name = `research-pulse-${(tag ?? "shortlist").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "shortlist"}.pdf`;
  const pdf = await toPdf(tag, rows, date);
  return new Response(Buffer.from(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${name}"`, "cache-control": "no-store" },
  });
}
