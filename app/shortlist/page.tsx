// Client shortlist: only papers marked "Share with a client", tagged with clients / mandates.
// Filter by tag and export a one-page summary per tag (printable page, PDF, Markdown).
// The system never sends these anywhere.
import { istShort } from "@/lib/time";
import { evidenceLabel, labText } from "@/lib/brief";
import { allTags, shortlistRows } from "@/lib/shortlist";
import { Shell } from "../shell";
import { MarkButtons, TierPill } from "../ui";
import { pc } from "../palette";
import { TagEditor } from "./tags";

export const dynamic = "force-dynamic";

export default async function ShortlistPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const tag = (await searchParams).tag?.trim() || null;
  const rows = await shortlistRows(tag);
  const tags = await allTags();
  const total = tag ? (await shortlistRows(null)).length : rows.length;
  const qs = tag ? `?tag=${encodeURIComponent(tag)}` : "";
  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">Ready to take to clients</div>
          <h1>Client shortlist</h1>
          <p className="sub">
            Papers marked “Share with a client”. Tag each one with a client or mandate, filter by tag, and export a one-page summary for a client deck.
            Nothing here is sent anywhere — you decide what reaches a client.
          </p>
        </div>

        <div className="card shortlist-bar">
          <div className="chips" role="tablist" aria-label="Filter by client or mandate">
            <a href="/shortlist" className={`chip ${tag ? "" : "on"}`} aria-current={tag ? undefined : "true"}>All<span className="n">{total}</span></a>
            {tags.map((t) => (
              <a key={t.tag} href={`/shortlist?tag=${encodeURIComponent(t.tag)}`} className={`chip ${tag?.toLowerCase() === t.tag.toLowerCase() ? "on" : ""}`}>
                {t.tag}<span className="n">{t.n}</span>
              </a>
            ))}
          </div>
          <div className="row export-row">
            <span className="small muted">Export {tag ? <>“<b>{tag}</b>”</> : "everything"} as a one-pager:</span>
            <a className="btn" href={`/shortlist/export${qs}`}>Printable page</a>
            <a className="btn" href={`/shortlist/export.pdf${qs}`}>PDF</a>
            <a className="btn" href={`/shortlist/export.md${qs}`}>Markdown</a>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="card empty" style={{ marginTop: 16 }}>
            <div className="big">🗂️</div>
            <p>{tag ? `No shortlisted paper is tagged “${tag}” yet.` : "Nothing on the shortlist yet."}</p>
            <p className="small" style={{ marginTop: 6 }}>Press <b>Share with a client</b> on any paper in the brief (or in the Monday email) and it will appear here.</p>
          </div>
        ) : (
          rows.map((r) => (
            <article key={r.paper_id} className={`paper short-card ${pc(r.topic_id ?? 0)}`}>
              <div className="spread xsmall" style={{ marginBottom: 8 }}>
                <span className="row" style={{ gap: 6 }}>
                  <TierPill tier={r.tier} />
                  <span className="chip soft" style={{ padding: "3px 10px" }}><span className="dot" />{r.topic ?? "—"}</span>
                </span>
                <span className="badge ok">Shared {istShort(r.marked_at)}</span>
              </div>
              <a className="title" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              {labText(r) && <div className="lab" style={{ marginTop: 4 }}>{labText(r)}</div>}
              <div className="explain">
                <div>
                  <div className="label">Why it matters</div>
                  <p>{r.why ?? r.reason_line2 ?? r.one_line ?? "—"}</p>
                  {evidenceLabel(r.evidence) && <p className="xsmall muted" style={{ marginTop: 6 }}>Evidence: {evidenceLabel(r.evidence)}</p>}
                </div>
                <div className="why">
                  <div className="label">Client angle</div>
                  {r.audience && <p><b>Who it matters to:</b> {r.audience}</p>}
                  {r.say && <p style={{ marginTop: 4 }}><i>“{r.say}”</i></p>}
                  {!r.audience && !r.say && <p>{r.about ?? "—"}</p>}
                </div>
              </div>
              <TagEditor paperId={r.paper_id} tags={r.tags} known={tags.map((t) => t.tag)} />
              <MarkButtons paperId={r.paper_id} itemId={null} topicId={r.topic_id} marks={r.marks} />
            </article>
          ))
        )}
      </main>
    </Shell>
  );
}
