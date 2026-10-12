// Email preview: renders the latest (or chosen) brief exactly as the Monday email looks — nothing is sent.
import { q1 } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { briefItems, renderEmail, type BriefRow } from "@/lib/brief";
import { Shell } from "../shell";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email preview · Research Pulse", robots: { index: false } };

export default async function EmailPreviewPage({ searchParams }: { searchParams: Promise<{ brief?: string }> }) {
  const sp = await searchParams;
  const brief = await q1<BriefRow>(
    Number(sp.brief) ? `SELECT * FROM briefs WHERE id = $1` : `SELECT * FROM briefs WHERE status = 'done' ORDER BY id DESC LIMIT 1`,
    Number(sp.brief) ? [Number(sp.brief)] : [],
  );
  const html =
    brief?.dashboard_json ? renderEmail(brief.id, brief.dashboard_json, await briefItems(brief.id, true), appUrl()).html : null;

  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">The Monday email</div>
          <h1>Email preview</h1>
          <p className="sub">
            How the Monday email looks{brief ? ` (brief #${brief.id})` : ""}. This page only renders it — nothing is sent. The buttons in the email
            are real one-click feedback links.
          </p>
        </div>
        {html ? (
          <iframe
            title="Monday email preview"
            srcDoc={html}
            sandbox="allow-popups allow-popups-to-escape-sandbox allow-top-navigation-by-user-activation"
            style={{ width: "100%", height: "80vh", border: "1px solid var(--line)", borderRadius: 12, background: "#f4f5f7" }}
          />
        ) : (
          <div className="card empty">No finished brief yet.</div>
        )}
      </main>
    </Shell>
  );
}
