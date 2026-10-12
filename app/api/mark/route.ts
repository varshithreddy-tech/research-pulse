// One-click feedback from the email: /api/mark?t=<signed token>. No login — the signed token is the
// permission (one brief item, one mark type, 14 days). GET shows a page that submits itself (so a
// link-scanning mail filter that only fetches the URL records nothing); POST records the mark.
// Marks are unique per paper and type, so clicking twice never creates a duplicate.
import { q, q1 } from "@/lib/db";
import { MARK_LABEL, verifyMarkToken } from "@/lib/markToken";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#fafaf9;color:#1c1917;margin:0}
main{max-width:520px;margin:12vh auto;padding:0 16px}.card{background:#fff;border:1px solid #e7e5e4;border-radius:10px;padding:20px}
h1{font-size:20px;margin:0 0 8px}p{margin:6px 0}.muted{color:#78716c;font-size:14px}button{font:inherit;padding:8px 14px;border-radius:6px;border:1px solid #1d4ed8;background:#1d4ed8;color:#fff;cursor:pointer}</style>
</head><body><main><div class="card">${body}</div></main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } },
  );
}

function bad(reason: "invalid" | "expired"): Response {
  return reason === "expired"
    ? page("Link expired", `<h1>This link has expired</h1><p>Feedback links work for 14 days. You can still mark the paper on the dashboard.</p>`, 410)
    : page("Link not valid", `<h1>This link isn't valid</h1><p>It may have been copied incompletely. You can mark the paper on the dashboard.</p>`, 400);
}

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("t") ?? "";
  const check = verifyMarkToken(token);
  if (!check.ok) return bad(check.reason);
  const label = MARK_LABEL[check.kind];
  return page(
    "Saving…",
    `<form method="post" id="f"><input type="hidden" name="t" value="${esc(token)}">
<h1>Saving: ${esc(label)}…</h1><noscript><p><button>Save “${esc(label)}”</button></p></noscript></form>
<script>document.getElementById("f").submit()</script>`,
  );
}

export async function POST(req: Request) {
  const token = String((await req.formData()).get("t") ?? "");
  const check = verifyMarkToken(token);
  if (!check.ok) return bad(check.reason);
  const item = await q1<{ paper_id: number; topic_id: number; title: string }>(
    `SELECT bi.paper_id, bi.topic_id, p.title FROM brief_items bi JOIN papers p ON p.id = bi.paper_id WHERE bi.id = $1`,
    [check.itemId],
  );
  if (!item) return bad("invalid");
  await q(
    `INSERT INTO marks (kind, paper_id, brief_item_id, topic_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [check.kind, item.paper_id, check.itemId, item.topic_id],
  );
  return page(
    "Saved",
    `<h1>Thanks — saved: ${esc(MARK_LABEL[check.kind])}</h1><p>${esc(item.title)}</p>
<p class="muted">You can change or undo this on your dashboard. Nothing is sent to anyone.</p>`,
  );
}
