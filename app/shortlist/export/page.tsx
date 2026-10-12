// Clean printable one-pager for a client / mandate tag (no sidebar). "Print / Save as PDF" uses the browser.
import { exportEntry, exportTitle, shortlistRows } from "@/lib/shortlist";
import { PrintButton } from "./print";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shortlist one-pager · Research Pulse", robots: { index: false } };

export default async function ExportPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const tag = (await searchParams).tag?.trim() || null;
  const rows = await shortlistRows(tag);
  const date = new Date().toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata", day: "numeric", month: "long", year: "numeric" });
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  return (
    <main className="onepager">
      <div className="no-print onepager-tools">
        <a href={`/shortlist${qs}`}>← Back to the shortlist</a>
        <span className="row">
          <PrintButton />
          <a className="btn" href={`/shortlist/export.pdf${qs}`}>Download PDF</a>
          <a className="btn" href={`/shortlist/export.md${qs}`}>Download Markdown</a>
        </span>
      </div>
      <header>
        <div className="eyebrow">Research Pulse · {date}</div>
        <h1>{exportTitle(tag)}</h1>
        <p className="muted small">{rows.length} paper{rows.length === 1 ? "" : "s"} from the client shortlist</p>
      </header>
      {rows.length === 0 && <p className="muted">No shortlisted papers carry this tag yet.</p>}
      <ol>
        {rows.map((r) => {
          const e = exportEntry(r);
          return (
            <li key={r.paper_id}>
              <h2><a href={e.url}>{e.title}</a></h2>
              {e.lines.map(([label, text]) =>
                label ? <p key={label}><b>{label}:</b> {text}</p> : <p key="meta" className="muted small">{text}</p>,
              )}
            </li>
          );
        })}
      </ol>
      <p className="muted small">This shortlist suggests. You decide what reaches a client.</p>
    </main>
  );
}
