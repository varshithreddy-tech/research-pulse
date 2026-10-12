// Client shortlist: only papers Kavita marked "Share with a client". The system never sends these anywhere.
import { q } from "@/lib/db";
import { TYPE_LABEL } from "@/lib/brief";
import { istShort } from "@/lib/time";
import { Nav } from "../nav";
import { MarkButtons, PubStatus } from "../ui";

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
  reason_line1: string | null;
  reason_line2: string | null;
  marks: string[];
}

export default async function ShortlistPage() {
  const rows = await q<Row>(
    `SELECT p.id AS paper_id, p.title, p.url, p.one_line, p.pub_status, p.venue, m.created_at AS marked_at,
       t.name AS topic, m.topic_id, bi.type, bi.score, bi.reason_line1, bi.reason_line2,
       COALESCE((SELECT array_agg(x.kind) FROM marks x WHERE x.paper_id = p.id AND x.kind <> 'missed'), '{}') AS marks
     FROM marks m
     JOIN papers p ON p.id = m.paper_id
     LEFT JOIN topics t ON t.id = m.topic_id
     LEFT JOIN LATERAL (SELECT * FROM brief_items b WHERE b.paper_id = p.id AND b.importance_status = 'assessed' ORDER BY b.id DESC LIMIT 1) bi ON TRUE
     WHERE m.kind = 'share'
     ORDER BY m.created_at DESC`,
  );
  return (
    <>
      <Nav />
      <main>
        <h1>Client shortlist</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Only papers you marked “Share with a client”. Nothing here is sent anywhere — you decide what reaches a client.
        </p>
        {rows.length === 0 && <div className="card muted">Nothing on the shortlist yet.</div>}
        {rows.map((r) => (
          <div key={r.paper_id} className="card">
            <a href={r.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{r.title}</a>
            <div className="small row">
              {r.topic && <span className="tag">{r.topic}</span>}
              <PubStatus s={r.pub_status} venue={r.venue} />
              <span className="muted">marked {istShort(r.marked_at)}</span>
            </div>
            {r.one_line && <div className="small">{r.one_line}</div>}
            {r.reason_line1 && (
              <div className="small muted">
                {r.type ? TYPE_LABEL[r.type] : ""} · score {r.score}/10 — {r.reason_line1} {r.reason_line2}
              </div>
            )}
            <MarkButtons paperId={r.paper_id} itemId={null} topicId={r.topic_id} marks={r.marks} />
          </div>
        ))}
      </main>
    </>
  );
}
