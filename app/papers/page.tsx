// All papers: every paper found in the week (Mon–Sun IST) — picked, the "+ N more", not relevant,
// not assessed, older, unconfirmed — and every blog. Each paper is listed ONCE, tagged with every
// topic it was checked for. Counts use the same definitions as the brief (lib/numbers.ts).
import { q, q1, allTopics } from "@/lib/db";
import { olderLabel } from "@/lib/brief";
import { PAPER_STATUS, paperStatusCounts, paperWeekCte } from "@/lib/numbers";
import { TIER_LABEL, type Tier } from "@/lib/steps/rank";
import { istShort, istWeekStart, weekBounds, weekLabel } from "@/lib/time";
import { Shell } from "../shell";
import { MarkButtons, PaperBadges, TierPill, fmt } from "../ui";
import { InstantSearch } from "../search";
import { pc } from "../palette";

export const dynamic = "force-dynamic";

type SP = { brief?: string; week?: string; topic?: string; status?: string; page?: string };

const PAGE = 60;
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
const CHIPS = ["all", "scanned", "on_topic", "picked", "more", "notrel", "na", "older", "unconfirmed"];

interface PaperRow {
  id: number;
  title: string;
  url: string;
  one_line: string | null;
  pub_status: string;
  venue: string | null;
  found_via: string;
  first_seen_at: string;
  confirm_status: string;
  is_research_paper: boolean;
  older: boolean;
  year: number | null;
  first_author: string | null;
  author_count: number;
  topics: { id: number; name: string; status: string; relevant: boolean | null; reason: string | null }[];
  home: number | null;
  item_id: number | null;
  tier: Tier | null;
  affiliation: string | null;
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
  // One definition of the week: Monday 00:00 → Monday 00:00 IST.
  const { start: ws, end: we } = brief ? { start: new Date(brief.week_start), end: new Date(brief.week_end) } : weekBounds(sp.week ? new Date(sp.week) : new Date());
  // "Picked" / "More" are relative to the chosen brief, or the latest finished brief for this week.
  const ctx = brief ?? (await q1<{ id: number }>(
    `SELECT id FROM briefs WHERE status = 'done' AND week_start = $1 AND week_end = $2 ORDER BY id DESC LIMIT 1`,
    [ws.toISOString(), we.toISOString()],
  ));
  const briefId = ctx?.id ?? null;
  const topicId = Number(sp.topic) || null;
  const status = sp.status && (PAPER_STATUS[sp.status] || BLOG_STATUS[sp.status]) ? sp.status : "all";
  const isBlogs = status in BLOG_STATUS;
  const page = Math.max(1, Number(sp.page) || 1);
  const base = [ws.toISOString(), we.toISOString(), topicId, briefId];

  const counts = await paperStatusCounts(ws, we, topicId, briefId);
  const blogCounts = await q<{ k: string; n: number }>(
    Object.entries(BLOG_STATUS)
      .map(([k, s]) => `SELECT '${k}' AS k, count(*)::int AS n FROM blogs b WHERE b.found_at >= $1 AND b.found_at < $2 AND ($3::int IS NULL OR b.topic_id = $3) AND (${s.sql})`)
      .join(" UNION ALL "),
    base.slice(0, 3),
  );
  const count = (k: string) => counts[k] ?? blogCounts.find((c) => c.k === k)?.n ?? 0;

  const papers = isBlogs
    ? []
    : await q<PaperRow>(
        `WITH ${paperWeekCte()}
         SELECT p.id, p.title, p.url, p.one_line, p.pub_status, p.venue, p.found_via, p.first_seen_at, p.confirm_status, p.is_research_paper,
           w.older, EXTRACT(YEAR FROM p.published_at)::int AS year, p.authors[1] AS first_author, COALESCE(cardinality(p.authors), 0) AS author_count,
           (SELECT jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'status', pt.status, 'relevant', pt.relevant, 'reason', pt.reason)
                   ORDER BY (pt.status = 'assessed' AND pt.relevant) DESC, t.sort_order, t.id)
              FROM paper_topics pt JOIN topics t ON t.id = pt.topic_id WHERE pt.paper_id = p.id) AS topics,
           w.home, bi.id AS item_id, bi.tier, bi.affiliation,
           COALESCE((SELECT array_agg(m.kind) FROM marks m WHERE m.paper_id = p.id AND m.kind <> 'missed'), '{}') AS marks
         FROM w JOIN papers p ON p.id = w.id
         LEFT JOIN brief_items bi ON bi.brief_id = $4 AND bi.paper_id = p.id AND bi.in_brief
         WHERE ${PAPER_STATUS[status].sql}
         ORDER BY (w.home IS NULL), bi.tier NULLS LAST, bi.rank NULLS LAST, w.rel DESC, p.id DESC
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
  const label = isBlogs ? BLOG_STATUS[status].label : PAPER_STATUS[status].label;

  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">Every paper checked — nothing hidden</div>
          <h1>All papers</h1>
          <p className="sub">
            Week of {weekLabel(ws, we)} (Mon–Sun, IST){brief ? ` · brief #${brief.id}` : ""}{topicName ? ` · ${topicName}` : ""}. Each paper is listed once,
            with every topic it was checked for — papers can fit more than one topic. Picked papers first.
          </p>
          <p className="xsmall muted" style={{ marginTop: 8 }}>
            {fmt(count("scanned"))} scanned → {fmt(count("on_topic"))} on her topics → {fmt(count("picked"))} picked
            {topicName ? ` (for ${topicName})` : ""}
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
          {brief && <a href={link({ topic: sp.topic, status: sp.status, week: ws.toISOString() }, {})} className="small">Switch to weekly view</a>}
        </form>

        <div className="row" style={{ margin: "16px 0 4px" }}>
          <InstantSearch target="list" placeholder={isBlogs ? "Search these blogs…" : "Search these papers — title, summary, topic or reason…"} />
        </div>
        <div className="chips" style={{ margin: "12px 0 16px" }} role="tablist" aria-label="Status">
          {[...CHIPS.map((k) => [k, PAPER_STATUS[k].label] as const), ...Object.entries(BLOG_STATUS).map(([k, s]) => [k, s.label] as const)].map(([k, lbl]) => (
            <a key={k} href={link(sp, { status: k === "all" ? undefined : k, page: undefined })} className={`chip ${k === status ? "on" : ""}`} aria-current={k === status ? "true" : undefined}>
              {lbl}<span className="n">{fmt(count(k))}</span>
            </a>
          ))}
        </div>
        <p className="xsmall faint" style={{ margin: "-6px 0 14px" }}>
          Scanned = on her topics + not relevant + not assessed. On her topics = picked + more on-topic.
          {topicId ? " With a topic chosen, “More on-topic” is exactly the brief’s “+ N more” for that topic." : ""}
        </p>

        {!isBlogs && (
          <>
            {papers.length === 0 ? (
              <div className="card empty">No papers match these filters.</div>
            ) : (
              <div className="table-wrap" id="list">
                <table className="stack-mobile">
                  <thead>
                    <tr><th>Paper</th><th>Topics</th><th>Feedback</th></tr>
                  </thead>
                  <tbody>
                    {papers.map((p) => {
                      const lab = p.affiliation ?? (p.first_author ? `${p.first_author}${p.author_count > 1 ? " et al." : ""}` : null);
                      const homeName = p.topics.find((t) => t.id === p.home)?.name;
                      return (
                        <tr key={p.id} data-search={`${p.title} ${p.one_line ?? ""} ${p.topics.map((t) => `${t.name} ${t.reason ?? ""}`).join(" ")}`.toLowerCase()}>
                          <td style={{ minWidth: 280 }}>
                            <a href={p.url} target="_blank" rel="noreferrer" style={{ fontWeight: 600, color: "var(--text)" }}>{p.title}</a>
                            {lab && <div className="xsmall muted" style={{ marginTop: 2 }}>{lab}</div>}
                            <div className="xsmall muted" style={{ marginTop: 4 }}>{p.one_line ?? "Summary not available yet — open the paper."}</div>
                            <PaperBadges pub_status={p.pub_status} venue={p.venue} older={p.older} year={p.year}>
                              {p.tier && <TierPill tier={p.tier} />}
                              {p.home && homeName && <span className="badge ok" title={p.tier ? TIER_LABEL[p.tier] : undefined}>Picked · {homeName}</span>}
                              {p.confirm_status !== "confirmed" && <span className="badge bad">{p.confirm_status === "pending" ? "Confirming…" : "Could not confirm"}</span>}
                              {!p.is_research_paper && <span className="badge">Not a research paper</span>}
                            </PaperBadges>
                            {p.older && <div className="xsmall faint" style={{ marginTop: 4 }}>{olderLabel(p.year)}</div>}
                            <div className="xsmall faint" style={{ marginTop: 4 }}>via {p.found_via} · found {istShort(p.first_seen_at)}</div>
                          </td>
                          <td data-label="Topics" className="small" style={{ minWidth: 220 }}>
                            <div className="tagcol">
                              {p.topics.map((t) => {
                                const on = t.status === "assessed" && t.relevant;
                                const state = on ? "On-topic" : t.status === "assessed" ? "Not relevant" : t.status === "pending" ? "Waiting for check" : "Not assessed";
                                return (
                                  <span key={t.id} className={`ttag ${on ? pc(t.id) : "off"}`} title={`${state}${t.reason ? ` — ${t.reason}` : ""}`}>
                                    <span className="dot" />{t.name}{!on && <em> · {state.toLowerCase()}</em>}
                                  </span>
                                );
                              })}
                            </div>
                          </td>
                          <td data-label="Feedback"><MarkButtons compact paperId={p.id} itemId={p.item_id} topicId={p.home ?? p.topics.find((t) => t.relevant)?.id ?? p.topics[0]?.id ?? null} marks={p.marks} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="spread small" style={{ marginTop: 14 }}>
              <span className="muted">{total ? `${label}: ${fmt((page - 1) * PAGE + 1)}–${fmt(Math.min(page * PAGE, total))} of ${fmt(total)}` : ""}</span>
              <span className="row">
                {page > 1 && <a href={link(sp, { page: String(page - 1) })}>← Previous</a>}
                {page * PAGE < total && <a href={link(sp, { page: String(page + 1) })}>Next →</a>}
              </span>
            </div>
          </>
        )}

        {isBlogs &&
          (blogs.length === 0 ? (
            <div className="card empty">No blogs found in this week.</div>
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
