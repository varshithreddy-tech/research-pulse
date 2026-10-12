// All papers: every paper checked — in the brief, the "+ N more", not relevant, not assessed, older,
// unconfirmed — and every blog (including blogs with no paper). Rank, never hide.
import { q, q1, allTopics } from "@/lib/db";
import { olderLabel, olderSql } from "@/lib/brief";
import { istShort, istWeekStart, weekLabel } from "@/lib/time";
import { Shell } from "../shell";
import { MarkButtons, PaperBadges, Relevance, fmt } from "../ui";
import { InstantSearch } from "../search";
import { pc } from "../palette";

export const dynamic = "force-dynamic";

type SP = { brief?: string; week?: string; topic?: string; status?: string; page?: string };

const PAGE = 60;
const NOT_OLDER = `NOT ${olderSql("p", "$1")}`;
const STATUS: Record<string, { label: string; sql: string }> = {
  all: { label: "All", sql: "TRUE" },
  inbrief: { label: "In brief", sql: "COALESCE(bi.in_brief, false)" },
  more: { label: "More (on-topic)", sql: `pt.status = 'assessed' AND pt.relevant AND NOT COALESCE(bi.in_brief, false) AND ${NOT_OLDER}` },
  notrel: { label: "Not relevant", sql: "pt.status = 'assessed' AND NOT pt.relevant" },
  na: { label: "Not assessed", sql: "pt.status IN ('not_assessed', 'pending')" },
  older: { label: "Older", sql: olderSql("p", "$1") },
  unconfirmed: { label: "Could not confirm", sql: "(p.confirm_status <> 'confirmed' OR NOT p.is_research_paper)" },
};
const BLOG_STATUS: Record<string, { label: string; sql: string }> = {
  blogs_nopaper: { label: "Blogs with no paper", sql: "b.evidence_status IN ('no_paper', 'link_not_confirmed')" },
  blogs_all: { label: "All blogs", sql: "TRUE" },
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
  const thisWeek = istWeekStart(new Date());
  const weeks = Array.from({ length: 12 }, (_, i) => new Date(thisWeek.getTime() - i * 7 * 86_400_000));

  const chosenBrief = Number(sp.brief) || null;
  const brief = chosenBrief ? await q1<{ id: number; week_start: string; week_end: string }>(`SELECT id, week_start, week_end FROM briefs WHERE id = $1`, [chosenBrief]) : null;
  const ws = brief ? new Date(brief.week_start) : sp.week ? new Date(sp.week) : thisWeek;
  const we = brief ? new Date(brief.week_end) : new Date(ws.getTime() + 7 * 86_400_000);
  // "In brief" / "More" are relative to the chosen brief, or the latest finished brief covering this window.
  const ctx = brief ?? (await q1<{ id: number }>(
    `SELECT id FROM briefs WHERE status = 'done' AND week_end > $1 AND week_start < $2 ORDER BY id DESC LIMIT 1`,
    [ws.toISOString(), we.toISOString()],
  ));
  const briefId = ctx?.id ?? null;
  const topicId = Number(sp.topic) || null;
  const status = sp.status && (STATUS[sp.status] || BLOG_STATUS[sp.status]) ? sp.status : "all";
  const isBlogs = status in BLOG_STATUS;
  const page = Math.max(1, Number(sp.page) || 1);
  const base = [ws.toISOString(), we.toISOString(), topicId, briefId];

  const FROM = `FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id JOIN topics t ON t.id = pt.topic_id
    LEFT JOIN brief_items bi ON bi.brief_id = $4 AND bi.paper_id = p.id AND bi.topic_id = pt.topic_id
    WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND ($3::int IS NULL OR pt.topic_id = $3)`;
  const counts = await q<{ k: string; n: number }>(
    `${Object.entries(STATUS).map(([k, s]) => `SELECT '${k}' AS k, count(*)::int AS n ${FROM} AND (${s.sql})`).join(" UNION ALL ")}
     UNION ALL ${Object.entries(BLOG_STATUS)
       .map(([k, s]) => `SELECT '${k}', count(*)::int FROM blogs b WHERE b.found_at >= $1 AND b.found_at < $2 AND ($3::int IS NULL OR b.topic_id = $3) AND (${s.sql})`)
       .join(" UNION ALL ")}`,
    base,
  );
  const count = (k: string) => counts.find((c) => c.k === k)?.n ?? 0;

  const papers = isBlogs
    ? []
    : await q<PaperRow>(
        `SELECT p.id, p.title, p.url, p.one_line, p.clean_status, p.pub_status, p.venue, p.found_via, p.first_seen_at,
           p.confirm_status, p.is_research_paper, ${olderSql("p", "$1")} AS older, EXTRACT(YEAR FROM p.published_at)::int AS year,
           pt.topic_id, t.name AS topic, pt.status, pt.relevant, pt.reason,
           bi.id AS item_id, bi.score, bi.type, bi.rank, bi.in_brief, bi.importance_status,
           COALESCE((SELECT array_agg(m.kind) FROM marks m WHERE m.paper_id = p.id AND m.kind <> 'missed'), '{}') AS marks
         ${FROM} AND (${STATUS[status].sql})
         ORDER BY (bi.rank IS NULL), bi.rank, (pt.status = 'assessed' AND pt.relevant) DESC, p.id DESC
         LIMIT ${PAGE} OFFSET ${(page - 1) * PAGE}`,
        base,
      );
  const blogs = isBlogs
    ? await q<{ id: number; url: string; title: string; topic: string | null; evidence_status: string; reason: string | null; found_at: string; paper_title: string | null; paper_url: string | null }>(
        `SELECT b.id, b.url, b.title, t.name AS topic, b.evidence_status, b.reason, b.found_at, p.title AS paper_title, p.url AS paper_url
         FROM blogs b LEFT JOIN topics t ON t.id = b.topic_id LEFT JOIN papers p ON p.id = b.linked_paper_id
         WHERE b.found_at >= $1 AND b.found_at < $2 AND ($3::int IS NULL OR b.topic_id = $3) AND (${BLOG_STATUS[status].sql})
         ORDER BY (b.evidence_status = 'paper_confirmed') DESC, b.id DESC LIMIT 300`,
        base.slice(0, 3),
      )
    : [];
  const total = count(status);
  const topicName = topics.find((t) => t.id === topicId)?.name;

  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">Every paper checked — nothing hidden</div>
          <h1>All papers</h1>
          <p className="sub">
            Every paper checked {brief ? `for brief #${brief.id}` : "in the week"} of {weekLabel(ws, we)}
            {topicName ? ` · ${topicName}` : ""} — nothing is hidden. Brief papers first.
          </p>
        </div>

        <form className="card row filters" style={{ gap: 10 }} aria-label="Filters">
          {brief ? (
            <input type="hidden" name="brief" value={brief.id} />
          ) : (
            <select name="week" defaultValue={ws.toISOString()} aria-label="Week">
              {weeks.map((w) => (
                <option key={w.toISOString()} value={w.toISOString()}>Week of {weekLabel(w, new Date(w.getTime() + 7 * 86_400_000))}</option>
              ))}
            </select>
          )}
          <select name="topic" defaultValue={topicId ?? ""} aria-label="Topic">
            <option value="">All topics</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.name}{t.active ? "" : " (paused)"}</option>
            ))}
          </select>
          {status !== "all" && <input type="hidden" name="status" value={status} />}
          <button>Apply</button>
          {brief && <a href={link({ topic: sp.topic, status: sp.status }, {})} className="small">Switch to weekly view</a>}
        </form>

        <div className="row" style={{ margin: "16px 0 4px" }}>
          <InstantSearch target="list" placeholder={isBlogs ? "Search these blogs…" : "Search these papers — title, summary, topic or reason…"} />
        </div>
        <div className="chips" style={{ margin: "12px 0 16px" }} role="tablist" aria-label="Status">
          {Object.entries({ ...STATUS, ...BLOG_STATUS }).map(([k, s]) => (
            <a key={k} href={link(sp, { status: k === "all" ? undefined : k, page: undefined })} className={`chip ${k === status ? "on" : ""}`} aria-current={k === status ? "true" : undefined}>
              {s.label}<span className="n">{fmt(count(k))}</span>
            </a>
          ))}
        </div>

        {!isBlogs && (
          <>
            {papers.length === 0 ? (
              <div className="card empty">No papers match these filters.</div>
            ) : (
              <div className="table-wrap" id="list">
                <table className="stack-mobile">
                  <thead>
                    <tr><th>Paper</th><th>Topic</th><th>Relevance</th><th>Feedback</th></tr>
                  </thead>
                  <tbody>
                    {papers.map((p) => (
                      <tr key={`${p.id}-${p.topic_id}`} data-search={`${p.title} ${p.one_line ?? ""} ${p.topic} ${p.reason ?? ""}`.toLowerCase()}>
                        <td style={{ minWidth: 260 }}>
                          <a href={p.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--text)" }}>{p.title}</a>
                          <div className="xsmall muted" style={{ marginTop: 4 }}>
                            {p.one_line ?? (p.clean_status === "pending" ? "Summary pending (next check)." : "Summary not available — open the paper.")}
                          </div>
                          <PaperBadges type={p.importance_status === "assessed" ? p.type : null} score={p.importance_status === "assessed" ? p.score : null} pub_status={p.pub_status} venue={p.venue} older={p.older} year={p.year}>
                            {p.in_brief && <span className="badge ok">In brief{p.rank ? ` · #${p.rank}` : ""}</span>}
                            {!p.in_brief && p.rank && <span className="badge">Ranked #{p.rank}</span>}
                            {p.confirm_status !== "confirmed" && <span className="badge bad">{p.confirm_status === "pending" ? "Confirming…" : "Could not confirm"}</span>}
                            {!p.is_research_paper && <span className="badge">Not a research paper</span>}
                          </PaperBadges>
                          {p.older && <div className="xsmall faint" style={{ marginTop: 4 }}>{olderLabel(p.year)}</div>}
                        </td>
                        <td data-label="Topic" className={`small ${pc(p.topic_id)}`}><span className="row" style={{ gap: 6, flexWrap: "nowrap" }}><span className="dot" />{p.topic}</span><div className="xsmall faint">via {p.found_via} · {istShort(p.first_seen_at)}</div></td>
                        <td data-label="Relevance" className="small" style={{ minWidth: 160 }}>
                          <Relevance status={p.status} relevant={p.relevant} />
                          {p.reason && <div className="xsmall muted" style={{ marginTop: 4 }}>{p.reason}</div>}
                        </td>
                        <td data-label="Feedback"><MarkButtons compact paperId={p.id} itemId={p.item_id} topicId={p.topic_id} marks={p.marks} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="spread small" style={{ marginTop: 14 }}>
              <span className="muted">{total ? `${fmt((page - 1) * PAGE + 1)}–${fmt(Math.min(page * PAGE, total))} of ${fmt(total)}` : ""}</span>
              <span className="row">
                {page > 1 && <a href={link(sp, { page: String(page - 1) })}>← Previous</a>}
                {page * PAGE < total && <a href={link(sp, { page: String(page + 1) })}>Next →</a>}
              </span>
            </div>
          </>
        )}

        {isBlogs &&
          (blogs.length === 0 ? (
            <div className="card empty">No blogs found in this window.</div>
          ) : (
            <div className="table-wrap" id="list">
              <table className="stack-mobile">
                <thead><tr><th>Blog</th><th>Topic</th><th>Evidence</th><th>Paper behind it / reason</th></tr></thead>
                <tbody>
                  {blogs.map((b) => (
                    <tr key={b.id} data-search={`${b.title} ${b.topic ?? ""} ${b.reason ?? ""} ${b.paper_title ?? ""}`.toLowerCase()}>
                      <td style={{ minWidth: 220 }}>
                        <a href={b.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--text)" }}>{b.title}</a>
                        <div className="xsmall faint">{istShort(b.found_at)}</div>
                      </td>
                      <td data-label="Topic" className="small">{b.topic ?? "—"}</td>
                      <td data-label="Evidence"><span className={`badge ${b.evidence_status === "paper_confirmed" ? "ok" : ""}`}>{BLOG_LABEL[b.evidence_status] ?? b.evidence_status}</span></td>
                      <td data-label="Paper" className="small">
                        {b.paper_url && <a href={b.paper_url} target="_blank" rel="noreferrer">{b.paper_title}</a>}
                        {b.reason && <div className="xsmall muted">{b.reason}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </main>
    </Shell>
  );
}
