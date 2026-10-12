// Cost & coverage: what was checked, what it cost, and how the system is being used — per week.
import { q } from "@/lib/db";
import { istShort, istWeekStart, weekLabel } from "@/lib/time";
import { windowCounts } from "@/lib/brief";
import { runCosts } from "@/lib/runGuard";
import { Shell } from "../shell";
import { AdminPanel, Notice, RunStatus, Tile, fmt, triggerLabel, usd } from "../ui";
import { pc } from "../palette";

export const dynamic = "force-dynamic";

const TAVILY_MONTHLY = 1000;

interface WeekRow {
  wk: string;
  papers: number;
  blogs: number;
  blogs_no_paper: number;
  gemini_calls: number;
  gemini_failed: number;
  gemini_cost: string;
  tavily: number;
  briefs_sent: number;
  shared: number;
  missed: number;
}

export default async function CoveragePage({ searchParams }: { searchParams: Promise<{ week?: string; msg?: string; link?: string }> }) {
  const sp = await searchParams;
  const thisWeek = istWeekStart(new Date());
  const ws = sp.week ? new Date(sp.week) : thisWeek;
  const we = new Date(ws.getTime() + 7 * 86_400_000);
  const since = new Date(thisWeek.getTime() - 7 * 7 * 86_400_000);

  // IST weeks start Monday 00:00 IST; `wk` is that instant in UTC.
  const W = (col: string) => `(date_trunc('week', ${col} AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`;
  const weeks = await q<WeekRow>(
    `WITH w AS (SELECT generate_series($1::timestamptz, $2::timestamptz, interval '7 days') AS wk)
     SELECT w.wk,
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id WHERE ${W("p.first_seen_at")} = w.wk)::int AS papers,
       (SELECT count(*) FROM blogs b WHERE ${W("b.found_at")} = w.wk)::int AS blogs,
       (SELECT count(*) FROM blogs b WHERE ${W("b.found_at")} = w.wk AND b.evidence_status IN ('no_paper', 'link_not_confirmed'))::int AS blogs_no_paper,
       (SELECT count(*) FROM ai_usage a WHERE ${W("a.created_at")} = w.wk)::int AS gemini_calls,
       (SELECT count(*) FROM ai_usage a WHERE ${W("a.created_at")} = w.wk AND NOT a.ok)::int AS gemini_failed,
       (SELECT COALESCE(sum(cost_usd), 0) FROM ai_usage a WHERE ${W("a.created_at")} = w.wk) AS gemini_cost,
       (SELECT COALESCE(sum(tavily_searches), 0) FROM runs r WHERE ${W("r.started_at")} = w.wk)::int AS tavily,
       (SELECT count(*) FROM briefs b WHERE b.sent_at IS NOT NULL AND ${W("b.sent_at")} = w.wk)::int AS briefs_sent,
       (SELECT count(*) FROM marks m WHERE m.kind = 'share' AND ${W("m.created_at")} = w.wk)::int AS shared,
       (SELECT count(*) FROM marks m WHERE m.kind = 'missed' AND ${W("m.created_at")} = w.wk)::int AS missed
     FROM w ORDER BY w.wk DESC`,
    [since.toISOString(), thisWeek.toISOString()],
  );
  const [month] = await q<{ used: number }>(
    `SELECT COALESCE(sum(tavily_searches), 0)::int AS used FROM runs
     WHERE started_at >= (date_trunc('month', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`,
  );

  const detail = await windowCounts(ws, we);
  const blogsByTopic = await q<{ topic_id: number; found: number; no_paper: number }>(
    `SELECT topic_id, count(*)::int AS found,
       count(*) FILTER (WHERE evidence_status IN ('no_paper', 'link_not_confirmed'))::int AS no_paper
     FROM blogs WHERE found_at >= $1 AND found_at < $2 GROUP BY topic_id`,
    [ws, we],
  );
  const categories = await q<{ category: string; runs: number; fetched: number; new: number; errors: number }>(
    `SELECT c.key AS category, count(*)::int AS runs,
       COALESCE(sum((c.value ->> 'fetched')::int), 0)::int AS fetched,
       COALESCE(sum((c.value ->> 'new')::int), 0)::int AS new,
       count(*) FILTER (WHERE c.value ? 'error')::int AS errors
     FROM runs r, jsonb_each(r.per_category) c
     WHERE r.kind = 'daily' AND r.started_at >= $1 AND r.started_at < $2
     GROUP BY c.key ORDER BY c.key`,
    [ws, we],
  );
  const steps = await q<{ step: string; calls: number; failed: number; input: number; output: number; cost: string }>(
    `SELECT step, count(*)::int AS calls, count(*) FILTER (WHERE NOT ok)::int AS failed,
       COALESCE(sum(input_tokens), 0)::int AS input, COALESCE(sum(output_tokens), 0)::int AS output, COALESCE(sum(cost_usd), 0) AS cost
     FROM ai_usage WHERE created_at >= $1 AND created_at < $2 GROUP BY step ORDER BY step`,
    [ws, we],
  );
  const runs = await q<{
    id: number; kind: string; trigger: string; status: string; started_at: string; heartbeat_at: string; finished_at: string | null;
    hops: number; tavily_searches: number; per_category: Record<string, { fetched?: number; new?: number; error?: string }>;
    errors: { at: string; where: string; message: string }[];
  }>(`SELECT * FROM runs ORDER BY id DESC LIMIT 20`);
  const costs = await runCosts(runs.map((r) => r.id));

  const week = weeks.find((w) => new Date(w.wk).getTime() === ws.getTime());
  const maxChecked = Math.max(1, ...detail.topics.map((t) => t.checked));

  return (
    <Shell>
      <main className="container">
        <Notice msg={sp.msg} link={sp.link} />
        <div className="page-head hero">
          <div className="spread" style={{ alignItems: "flex-end" }}>
            <div>
              <div className="eyebrow">What was checked and what it cost</div>
          <h1>Cost &amp; coverage</h1>
              <p className="sub">Week of {weekLabel(ws, we)} (IST) — what was checked, and what it cost.</p>
            </div>
            <form className="row small" aria-label="Choose week">
              <select name="week" defaultValue={ws.toISOString()} aria-label="Week">
                {weeks.map((w) => {
                  const s = new Date(w.wk);
                  return <option key={w.wk} value={s.toISOString()}>Week of {weekLabel(s, new Date(s.getTime() + 7 * 86_400_000))}</option>;
                })}
              </select>
              <button>Show</button>
            </form>
          </div>
        </div>

        <div className="tiles">
          <Tile tone={0} num={usd(week?.gemini_cost ?? 0, 2)} label="Gemini cost this week" sub={`at ${process.env.GEMINI_PRICE_INPUT_PER_M ?? "?"} / ${process.env.GEMINI_PRICE_OUTPUT_PER_M ?? "?"} $ per 1M tokens`} />
          <Tile tone={3} num={week?.gemini_calls ?? 0} label="Gemini calls" sub={`${fmt(week?.gemini_failed)} failed (retried)`} />
          <Tile tone={1} num={`${fmt(month?.used)} / ${fmt(TAVILY_MONTHLY)}`} label="Tavily searches" sub="used this month (free plan)" />
          <Tile tone={2} num={detail.papers_checked} label="papers checked" sub={`${fmt(detail.older_discussed)} older papers also discussed`} />
        </div>

        <section className="section">
          <div className="section-head">
            <h2>Papers per topic</h2>
            <span className="xsmall muted">
              light bar = checked · strong bar = judged on-topic · hover a bar for numbers
            </span>
          </div>
          <div className="card bars">
            {detail.topics.map((t) => {
              const b = blogsByTopic.find((x) => x.topic_id === t.topic_id);
              return (
                <div key={t.topic_id} className={`bar-row ${pc(t.topic_id)}`}>
                  <div className="bar-name">
                    <span className="dot" /><a href={`/papers?week=${ws.toISOString()}&topic=${t.topic_id}`}>{t.name}</a>
                    {t.checked === 0 && <span className="badge bad" style={{ marginLeft: 6 }}>0 papers</span>}
                  </div>
                  <div>
                    <div className="bar-track" title={`${t.checked} checked, ${t.relevant} on-topic`}>
                      <div className="bar-checked" style={{ width: `${(t.checked / maxChecked) * 100}%` }} />
                      <div className="bar-relevant" style={{ width: `${(t.relevant / maxChecked) * 100}%` }} />
                      <span className="bar-tip">{t.checked ? Math.round((t.relevant / t.checked) * 100) : 0}% on-topic</span>
                    </div>
                    <div className="bar-legend">
                      {fmt(t.checked)} checked · {fmt(t.relevant)} on-topic
                      {t.not_assessed + t.pending ? ` · ${fmt(t.not_assessed + t.pending)} waiting / not assessed` : ""}
                      {` · ${fmt(b?.found)} blogs (${fmt(b?.no_paper)} with no paper)`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Recent runs</h2><span className="xsmall faint">every run with its Gemini cost</span></div>
          <div className="table-wrap">
            <table className="stack-mobile">
              <thead>
                <tr><th>Run</th><th>Started (IST)</th><th>Status</th><th className="num">Gemini calls</th><th className="num">Gemini cost</th><th className="num">Tavily</th><th>Notes</th></tr>
              </thead>
              <tbody>
                {runs.map((r) => {
                  const c = costs.get(r.id);
                  const cats = Object.values(r.per_category ?? {});
                  const fetched = cats.reduce((s, v) => s + (v.fetched ?? 0), 0);
                  const fresh = cats.reduce((s, v) => s + (v.new ?? 0), 0);
                  return (
                    <tr key={r.id} id={`run-${r.id}`}>
                      <td><b>#{r.id}</b> {r.kind === "daily" ? "Daily" : "Brief"} <span className="xsmall faint">{triggerLabel(r.trigger)}</span></td>
                      <td data-label="Started" className="small">{istShort(r.started_at)}</td>
                      <td data-label="Status"><RunStatus status={r.status} heartbeat={r.heartbeat_at} />{r.hops ? <span className="xsmall faint"> · {r.hops} hops</span> : null}</td>
                      <td data-label="Gemini calls" className="num">{fmt(c?.calls)}</td>
                      <td data-label="Gemini cost" className="num">{usd(c?.cost)}</td>
                      <td data-label="Tavily" className="num">{r.tavily_searches}</td>
                      <td data-label="Notes" className="xsmall">
                        {r.kind === "daily" && cats.length > 0 && <div className="muted">arXiv: {fmt(fresh)} new of {fmt(fetched)} fetched</div>}
                        {r.errors?.length ? (
                          <details>
                            <summary>{r.errors.length} note{r.errors.length > 1 ? "s" : ""}</summary>
                            {r.errors.map((e, i) => (
                              <div key={i} className="muted"><b>{e.where}</b>: {e.message}</div>
                            ))}
                          </details>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <section className="section">
          <div className="section-head"><h2>Per week</h2></div>
          <div className="table-wrap">
            <table className="stack-mobile">
              <thead>
                <tr>
                  <th>Week (IST)</th><th className="num">Papers</th><th className="num">Blogs (no paper)</th><th className="num">Gemini calls</th>
                  <th className="num">Gemini cost</th><th className="num">Tavily</th><th className="num">Briefs sent</th><th className="num">Shared</th><th className="num">Missed</th>
                </tr>
              </thead>
              <tbody>
                {weeks.map((w) => {
                  const s = new Date(w.wk);
                  return (
                    <tr key={w.wk} style={s.getTime() === ws.getTime() ? { background: "var(--accent-soft)" } : undefined}>
                      <td><a href={`/coverage?week=${s.toISOString()}`}>{weekLabel(s, new Date(s.getTime() + 7 * 86_400_000))}</a></td>
                      <td data-label="Papers" className="num">{fmt(w.papers)}</td>
                      <td data-label="Blogs (no paper)" className="num">{fmt(w.blogs)} ({fmt(w.blogs_no_paper)})</td>
                      <td data-label="Gemini calls" className="num">{fmt(w.gemini_calls)}</td>
                      <td data-label="Gemini cost" className="num">{usd(w.gemini_cost)}</td>
                      <td data-label="Tavily" className="num">{fmt(w.tavily)}</td>
                      <td data-label="Briefs sent" className="num">{fmt(w.briefs_sent)}</td>
                      <td data-label="Shared" className="num">{fmt(w.shared)}</td>
                      <td data-label="You missed this" className="num">{fmt(w.missed)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="xsmall faint" style={{ marginTop: 8 }}>Gemini cost uses full input price (cached-token discounts not subtracted).</p>
        </section>

        <section className="section">
          <details>
            <summary>More detail: arXiv per category and Gemini by step</summary>
            <h3 style={{ margin: "16px 0 8px" }}>arXiv fetches per category</h3>
            <div className="table-wrap">
              <table className="stack-mobile">
                <thead><tr><th>Category</th><th className="num">Daily runs</th><th className="num">Fetched</th><th className="num">New</th><th className="num">Errors</th></tr></thead>
                <tbody>
                  {categories.map((c) => (
                    <tr key={c.category}>
                      <td>{c.category}</td>
                      <td data-label="Runs" className="num">{c.runs}</td>
                      <td data-label="Fetched" className="num">{fmt(c.fetched)}</td>
                      <td data-label="New" className="num">{fmt(c.new)}</td>
                      <td data-label="Errors" className="num">{c.errors ? <span className="badge bad">{c.errors}</span> : 0}</td>
                    </tr>
                  ))}
                  {categories.length === 0 && <tr><td colSpan={5} className="muted">No daily runs this week yet.</td></tr>}
                </tbody>
              </table>
            </div>
            <p className="xsmall faint" style={{ marginTop: 6 }}>“Fetched” counts a cross-listed paper once per category; “new” counts it once overall.</p>
            <h3 style={{ margin: "16px 0 8px" }}>Gemini by step</h3>
            <div className="table-wrap">
              <table className="stack-mobile">
                <thead><tr><th>Step</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Input tokens</th><th className="num">Output tokens</th><th className="num">Cost</th></tr></thead>
                <tbody>
                  {steps.map((s) => (
                    <tr key={s.step}>
                      <td>{s.step}</td>
                      <td data-label="Calls" className="num">{fmt(s.calls)}</td>
                      <td data-label="Failed" className="num">{fmt(s.failed)}</td>
                      <td data-label="Input" className="num">{fmt(s.input)}</td>
                      <td data-label="Output" className="num">{fmt(s.output)}</td>
                      <td data-label="Cost" className="num">{usd(s.cost)}</td>
                    </tr>
                  ))}
                  {steps.length === 0 && <tr><td colSpan={6} className="muted">No Gemini calls this week yet.</td></tr>}
                </tbody>
              </table>
            </div>
          </details>
        </section>

        <AdminPanel />
      </main>
    </Shell>
  );
}
