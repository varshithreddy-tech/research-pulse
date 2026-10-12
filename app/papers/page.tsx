// All papers: every paper checked (including the "+ N more", off-topic ones and those not assessed)
// and every blog (including blogs with no paper). Rank, never hide.
import { q, q1, allTopics } from "@/lib/db";
import { TYPE_LABEL, olderLabel, olderSql } from "@/lib/brief";
import { istShort, istWeekStart, weekLabel } from "@/lib/time";
import { Nav } from "../nav";
import { MarkButtons, PubStatus, Relevance, fmt } from "../ui";

export const dynamic = "force-dynamic";

type SP = { brief?: string; week?: string; topic?: string; status?: string; view?: string; page?: string };

const PAGE = 100;
const STATUS: Record<string, { label: string; sql: string }> = {
  all: { label: "All", sql: "TRUE" },
  on: { label: "On-topic", sql: "pt.status = 'assessed' AND pt.relevant" },
  off: { label: "Not on-topic", sql: "pt.status = 'assessed' AND NOT pt.relevant" },
  na: { label: "Not assessed", sql: "pt.status = 'not_assessed'" },
  wait: { label: "Waiting for check", sql: "pt.status = 'pending'" },
  unconfirmed: { label: "Could not confirm", sql: "p.confirm_status <> 'confirmed' OR NOT p.is_research_paper" },
};

const BLOG_LABEL: Record<string, string> = {
  paper_confirmed: "Paper confirmed",
  no_paper: "No paper",
  link_not_confirmed: "Link not confirmed",
  not_assessed: "Not assessed",
  pending: "Waiting for check",
};

interface PaperRow {
  id: number;
  title: string;
  url: string;
  one_line: string | null;
  clean_status: string;
  pub_status: string;
  venue: string | null;
  found_via: string;
  first_seen_at: string;
  confirm_status: string;
  is_research_paper: boolean;
  older: boolean;
  year: number | null;
  topic_id: number;
  topic: string;
  status: string;
  relevant: boolean | null;
  reason: string | null;
  item_id: number | null;
  score: number | null;
  type: string | null;
  rank: number | null;
  in_brief: boolean | null;
  importance_status: string | null;
  reason_line1: string | null;
  reason_line2: string | null;
  marks: string[];
}

function link(sp: SP, patch: Partial<SP>): string {
  const merged = { ...sp, ...patch };
  const qs = new URLSearchParams(Object.entries(merged).filter(([, v]) => v !== undefined && v !== "") as [string, string][]);
  return `/papers?${qs}`;
}

export default async function PapersPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const topics = await allTopics();
  const briefId = Number(sp.brief) || null;
  const brief = briefId ? await q1<{ week_start: string; week_end: string }>(`SELECT week_start, week_end FROM briefs WHERE id = $1`, [briefId]) : null;

  const thisWeek = istWeekStart(new Date());
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(thisWeek.getTime() - i * 7 * 86_400_000));
  const ws = brief ? new Date(brief.week_start) : sp.week ? new Date(sp.week) : thisWeek;
  const we = brief ? new Date(brief.week_end) : new Date(ws.getTime() + 7 * 86_400_000);
  const topicId = Number(sp.topic) || null;
  const status = STATUS[sp.status ?? "all"] ? (sp.status ?? "all") : "all";
  const view = sp.view === "blogs" ? "blogs" : "papers";
  const page = Math.max(1, Number(sp.page) || 1);

  const base = [ws.toISOString(), we.toISOString(), topicId];
  const counts = await q<{ k: string; n: number }>(
    `SELECT k, n FROM (
       SELECT 'all' AS k, count(*)::int AS n FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND ($3::int IS NULL OR pt.topic_id = $3)
       ${Object.entries(STATUS)
         .filter(([k]) => k !== "all")
         .map(([k, s]) => `UNION ALL SELECT '${k}', count(*)::int FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND ($3::int IS NULL OR pt.topic_id = $3) AND (${s.sql})`)
         .join("\n")}
     ) x`,
    base,
  );
  const count = (k: string) => counts.find((c) => c.k === k)?.n ?? 0;

  const papers =
    view === "papers"
      ? await q<PaperRow>(
          `SELECT p.id, p.title, p.url, p.one_line, p.clean_status, p.pub_status, p.venue, p.found_via, p.first_seen_at,
             p.confirm_status, p.is_research_paper, ${olderSql("p", "$1")} AS older, EXTRACT(YEAR FROM p.published_at)::int AS year, pt.topic_id, t.name AS topic, pt.status, pt.relevant, pt.reason,
             bi.id AS item_id, bi.score, bi.type, bi.rank, bi.in_brief, bi.importance_status, bi.reason_line1, bi.reason_line2,
             COALESCE((SELECT array_agg(m.kind) FROM marks m WHERE m.paper_id = p.id AND m.kind <> 'missed'), '{}') AS marks
           FROM paper_topics pt
           JOIN papers p ON p.id = pt.paper_id
           JOIN topics t ON t.id = pt.topic_id
           LEFT JOIN brief_items bi ON bi.brief_id = $4 AND bi.paper_id = p.id AND bi.topic_id = pt.topic_id
           WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND ($3::int IS NULL OR pt.topic_id = $3) AND (${STATUS[status].sql})
           ORDER BY (bi.rank IS NULL), bi.rank, (pt.status = 'assessed' AND pt.relevant) DESC, p.id DESC
           LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
          [...base, briefId],
        )
      : [];

  const blogs =
    view === "blogs"
      ? await q<{ id: number; url: string; title: string; topic: string | null; evidence_status: string; reason: string | null; found_at: string; paper_title: string | null; paper_url: string | null }>(
          `SELECT b.id, b.url, b.title, t.name AS topic, b.evidence_status, b.reason, b.found_at, p.title AS paper_title, p.url AS paper_url
           FROM blogs b LEFT JOIN topics t ON t.id = b.topic_id LEFT JOIN papers p ON p.id = b.linked_paper_id
           WHERE b.found_at >= $1 AND b.found_at < $2 AND ($3::int IS NULL OR b.topic_id = $3)
           ORDER BY (b.evidence_status = 'paper_confirmed') DESC, b.id DESC LIMIT 300`,
          base,
        )
      : [];

  const total = count(status);
  return (
    <>
      <Nav />
      <main>
        <h1>All papers</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Every paper checked {brief ? `for brief #${briefId}` : "this week"} ({weekLabel(ws, we)}) — nothing is hidden. Ranked papers first.
        </p>
        <form className="row card">
          {briefId && <input type="hidden" name="brief" value={briefId} />}
          {!briefId && (
            <select name="week" defaultValue={ws.toISOString()}>
              {weeks.map((w) => (
                <option key={w.toISOString()} value={w.toISOString()}>
                  Week of {weekLabel(w, new Date(w.getTime() + 7 * 86_400_000))}
                </option>
              ))}
            </select>
          )}
          <select name="topic" defaultValue={topicId ?? ""}>
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (paused)"}</option>
            ))}
          </select>
          <select name="view" defaultValue={view}>
            <option value="papers">Papers</option>
            <option value="blogs">Blogs</option>
          </select>
          <button>Show</button>
          {briefId && <a href="/papers" className="small">Switch to weekly view</a>}
        </form>

        {view === "papers" && (
          <>
            <div className="row small" style={{ margin: "8px 0" }}>
              {Object.entries(STATUS).map(([k, s]) => (
                <a key={k} href={link(sp, { status: k, page: undefined })} className={`tag ${k === status ? "ok" : ""}`}>
                  {s.label} {fmt(count(k))}
                </a>
              ))}
            </div>
            {papers.length === 0 && <div className="card muted">No papers match.</div>}
            {papers.map((p) => (
              <div key={`${p.id}-${p.topic_id}`} className="card">
                <div className="spread">
                  <a href={p.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600 }}>{p.title}</a>
                  {p.rank && <span className="small muted">#{p.rank} in {p.topic}{p.in_brief ? " · in the brief" : ""}</span>}
                </div>
                <div className="small row" style={{ marginTop: 2 }}>
                  <span className="tag">{p.topic}</span>
                  <Relevance status={p.status} relevant={p.relevant} />
                  <PubStatus s={p.pub_status} venue={p.venue} />
                  {p.confirm_status !== "confirmed" && <span className="tag bad">{p.confirm_status === "pending" ? "Confirming…" : "Could not confirm"}</span>}
                  {!p.is_research_paper && <span className="tag">Not a research paper</span>}
                  {p.older && <span className="tag warn">{olderLabel(p.year)}</span>}
                  <span className="muted">via {p.found_via} · found {istShort(p.first_seen_at)}</span>
                </div>
                <div className="small" style={{ marginTop: 4 }}>
                  {p.one_line ?? <span className="muted">{p.clean_status === "pending" ? "Summary pending (next check)." : "Summary not available (AI check failed) — open the paper."}</span>}
                </div>
                {p.reason && <div className="small muted">Relevance: {p.reason}</div>}
                {p.importance_status === "assessed" && (
                  <div className="small">
                    {p.type ? TYPE_LABEL[p.type] : ""} · score {p.score}/10 — {p.reason_line1} {p.reason_line2}
                  </div>
                )}
                {p.importance_status === "not_assessed" && <div className="small muted">Importance: not assessed (AI check failed)</div>}
                <MarkButtons paperId={p.id} itemId={p.item_id} topicId={p.topic_id} marks={p.marks} />
              </div>
            ))}
            <div className="row">
              {page > 1 && <a href={link(sp, { page: String(page - 1) })}>← Previous</a>}
              <span className="small muted">
                {fmt((page - 1) * PAGE + 1)}–{fmt(Math.min(page * PAGE, total))} of {fmt(total)}
              </span>
              {page * PAGE < total && <a href={link(sp, { page: String(page + 1) })}>Next →</a>}
            </div>
          </>
        )}

        {view === "blogs" && (
          <div className="scroll">
            <table>
              <thead>
                <tr><th>Blog</th><th>Topic</th><th>Evidence</th><th>Paper behind it / reason</th><th>Found</th></tr>
              </thead>
              <tbody>
                {blogs.map((b) => (
                  <tr key={b.id}>
                    <td><a href={b.url} target="_blank" rel="noreferrer">{b.title}</a></td>
                    <td>{b.topic ?? "—"}</td>
                    <td><span className={`tag ${b.evidence_status === "paper_confirmed" ? "ok" : ""}`}>{BLOG_LABEL[b.evidence_status] ?? b.evidence_status}</span></td>
                    <td>
                      {b.paper_url && <a href={b.paper_url} target="_blank" rel="noreferrer">{b.paper_title}</a>}
                      {b.reason && <div className="muted">{b.reason}</div>}
                    </td>
                    <td className="muted">{istShort(b.found_at)}</td>
                  </tr>
                ))}
                {blogs.length === 0 && <tr><td colSpan={5} className="muted">No blogs found in this window.</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
