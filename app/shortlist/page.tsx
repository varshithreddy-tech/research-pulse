// Client shortlist: only papers marked "Share with a client". The system never sends these anywhere.
import { q } from "@/lib/db";
import { istShort } from "@/lib/time";
import { Shell } from "../shell";
import { MarkButtons, PaperBadges } from "../ui";
import { pc } from "../palette";

export const dynamic = "force-dynamic";

interface Row {
  paper_id: number;
  title: string;
  url: string;
  one_line: string | null;
  pub_status: string;
  venue: string | null;
  marked_at: string;
  topic: string | null;
  topic_id: number | null;
  type: string | null;
  score: number | null;
  about: string | null;
  why: string | null;
  reason_line2: string | null;
  marks: string[];
}

export default async function ShortlistPage() {
  const rows = await q<Row>(
    `SELECT p.id AS paper_id, p.title, p.url, p.one_line, p.pub_status, p.venue, m.created_at AS marked_at,
       t.name AS topic, m.topic_id, bi.type, bi.score, bi.about, bi.why, bi.reason_line2,
       COALESCE((SELECT array_agg(x.kind) FROM marks x WHERE x.paper_id = p.id AND x.kind <> 'missed'), '{}') AS marks
     FROM marks m
     JOIN papers p ON p.id = m.paper_id
     LEFT JOIN topics t ON t.id = m.topic_id
     LEFT JOIN LATERAL (SELECT * FROM brief_items b WHERE b.paper_id = p.id AND b.importance_status = 'assessed'
                        ORDER BY (b.about IS NOT NULL) DESC, b.id DESC LIMIT 1) bi ON TRUE
     WHERE m.kind = 'share'
     ORDER BY m.created_at DESC`,
  );
  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">Ready to take to clients</div>
          <h1>Client shortlist</h1>
          <p className="sub">Only papers marked “Share with a client”. Nothing here is sent anywhere — you decide what reaches a client.</p>
        </div>
        {rows.length === 0 ? (
          <div className="card empty">
            <div className="big">🗂️</div>
            <p>Nothing on the shortlist yet.</p>
            <p className="small" style={{ marginTop: 6 }}>Press <b>Share with a client</b> on any paper in the brief (or in the Monday email) and it will appear here.</p>
          </div>
        ) : (
          rows.map((r) => (
            <article key={r.paper_id} className={`paper ${pc(r.topic_id)}`}>
              <div className="spread xsmall" style={{ marginBottom: 8 }}>
                <span className="chip soft" style={{ padding: "3px 10px" }}><span className="dot" />{r.topic ?? "—"}</span>
                <span className="badge ok">Shared {istShort(r.marked_at)}</span>
              </div>
              <a className="title" href={r.url} target="_blank" rel="noreferrer">{r.title}</a>
              <PaperBadges type={r.type} score={r.score} pub_status={r.pub_status} venue={r.venue} />
              <div className="explain">
                <div>
                  <div className="label">What it&apos;s about</div>
                  <p>{r.about ?? r.one_line ?? "—"}</p>
                </div>
                <div className="why">
                  <div className="label">Why it may matter</div>
                  <p>{r.why ?? r.reason_line2 ?? "—"}</p>
                </div>
              </div>
              <MarkButtons paperId={r.paper_id} itemId={null} topicId={r.topic_id} marks={r.marks} />
            </article>
          ))
        )}
      </main>
    </Shell>
  );
}
