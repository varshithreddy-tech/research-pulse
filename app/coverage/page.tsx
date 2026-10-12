// Cost & coverage: what was checked, what it cost, and how the system is being used — per week.
import { q } from "@/lib/db";
import { istShort, istWeekStart, weekLabel } from "@/lib/time";
import { windowCounts } from "@/lib/brief";
import { Nav } from "../nav";
import { AdminButtons, Notice, RunStatus, fmt, usd } from "../ui";
import { runCosts } from "@/lib/runGuard";

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

  return (
    <>
      <Nav />
      <main>
        <Notice msg={sp.msg} link={sp.link} />
        <div className="spread">
          <h1>Cost &amp; coverage</h1>
          <AdminButtons />
        </div>
        <p className="small">
          Tavily searches this month: <b>{fmt(month?.used)}</b> of {fmt(TAVILY_MONTHLY)} free.
        </p>

        <h2>Per week</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Week (IST)</th><th className="num">Papers checked</th><th className="num">Blogs checked</th><th className="num">Blogs with no paper</th>
                <th className="num">Gemini calls (failed)</th><th className="num">Gemini cost</th><th className="num">Tavily searches</th>
                <th className="num">Briefs sent</th><th className="num">Papers shared</th><th className="num">“You missed this”</th>
              </tr>
            </thead>
            <tbody>
              {weeks.map((w) => {
                const s = new Date(w.wk);
                return (
                  <tr key={w.wk} style={s.getTime() === ws.getTime() ? { background: "#eff6ff" } : undefined}>
                    <td><a href={`/coverage?week=${s.toISOString()}`}>{weekLabel(s, new Date(s.getTime() + 7 * 86_400_000))}</a></td>
                    <td className="num">{fmt(w.papers)}</td>
                    <td className="num">{fmt(w.blogs)}</td>
                    <td className="num">{fmt(w.blogs_no_paper)}</td>
                    <td className="num">{fmt(w.gemini_calls)} ({fmt(w.gemini_failed)})</td>
                    <td className="num">{usd(w.gemini_cost)}</td>
                    <td className="num">{fmt(w.tavily)}</td>
                    <td className="num">{fmt(w.briefs_sent)}</td>
                    <td className="num">{fmt(w.shared)}</td>
                    <td className="num">{fmt(w.missed)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">Gemini cost uses GEMINI_PRICE_INPUT_PER_M / GEMINI_PRICE_OUTPUT_PER_M at full input price (cached-token discounts not subtracted).</p>

        <h2>Week of {weekLabel(ws, we)} — per topic</h2>
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>Topic</th><th className="num">Papers checked</th><th className="num">On-topic</th><th className="num">Not on-topic</th>
                <th className="num">Not assessed</th><th className="num">Waiting</th><th className="num">Blogs found</th><th className="num">Blogs with no paper</th>
              </tr>
            </thead>
            <tbody>
              {detail.topics.map((t) => {
                const b = blogsByTopic.find((x) => x.topic_id === t.topic_id);
                return (
                  <tr key={t.topic_id}>
                    <td><a href={`/papers?week=${ws.toISOString()}&topic=${t.topic_id}`}>{t.name}</a>{t.checked === 0 && <span className="tag bad" style={{ marginLeft: 6 }}>0 papers</span>}</td>
                    <td className="num">{fmt(t.checked)}</td>
                    <td className="num">{fmt(t.relevant)}</td>
                    <td className="num">{fmt(t.not_relevant)}</td>
                    <td className="num">{fmt(t.not_assessed)}</td>
                    <td className="num">{fmt(t.pending)}</td>
                    <td className="num">{fmt(b?.found)}</td>
                    <td className="num">{fmt(b?.no_paper)}</td>
                  </tr>
                );
              })}
              <tr>
                <td><b>All topics (distinct papers)</b></td>
                <td className="num"><b>{fmt(detail.papers_checked)}</b></td>
                <td colSpan={4} className="muted">{detail.unconfirmed ? `${fmt(detail.unconfirmed)} research-site / blog links could not be confirmed (still listed)` : ""}</td>
                <td className="num">{fmt(detail.blogs_checked)}</td>
                <td className="num">{fmt(detail.blogs_no_paper)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <h2>arXiv fetches per category</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Category</th><th className="num">Daily runs</th><th className="num">Papers fetched</th><th className="num">New papers</th><th className="num">Fetch errors</th></tr></thead>
            <tbody>
              {categories.map((c) => (
                <tr key={c.category}>
                  <td>{c.category}</td><td className="num">{c.runs}</td><td className="num">{fmt(c.fetched)}</td><td className="num">{fmt(c.new)}</td>
                  <td className="num">{c.errors ? <span className="tag bad">{c.errors}</span> : 0}</td>
                </tr>
              ))}
              {categories.length === 0 && <tr><td colSpan={5} className="muted">No daily runs this week yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="small muted">“Fetched” counts a cross-listed paper once per category; “new” counts it once overall.</p>

        <h2>Gemini by step</h2>
        <table>
          <thead><tr><th>Step</th><th className="num">Calls</th><th className="num">Failed</th><th className="num">Input tokens</th><th className="num">Output tokens</th><th className="num">Cost</th></tr></thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.step}>
                <td>{s.step}</td><td className="num">{fmt(s.calls)}</td><td className="num">{fmt(s.failed)}</td>
                <td className="num">{fmt(s.input)}</td><td className="num">{fmt(s.output)}</td><td className="num">{usd(s.cost)}</td>
              </tr>
            ))}
            {steps.length === 0 && <tr><td colSpan={6} className="muted">No Gemini calls this week yet.</td></tr>}
          </tbody>
        </table>

        <h2>Recent runs</h2>
        <div className="scroll">
          <table>
            <thead><tr><th>Run</th><th>Started</th><th>Status</th><th className="num">Hops</th><th>arXiv (new / fetched)</th><th className="num">Tavily</th><th className="num">Gemini calls</th><th className="num">Gemini cost</th><th>Errors</th></tr></thead>
            <tbody>
              {runs.map((r) => {
                const cats = Object.entries(r.per_category ?? {});
                return (
                  <tr key={r.id} id={`run-${r.id}`}>
                    <td>#{r.id} {r.kind} <span className="muted">({r.trigger})</span></td>
                    <td>{istShort(r.started_at)}</td>
                    <td><RunStatus status={r.status} heartbeat={r.heartbeat_at} /></td>
                    <td className="num">{r.hops}</td>
                    <td className="small">
                      {cats.length
                        ? cats.map(([c, v]) => (
                            <span key={c} style={{ marginRight: 8, color: v.error ? "var(--bad)" : undefined }}>
                              {c} {v.error ? "error" : `${v.new ?? 0}/${v.fetched ?? 0}`}
                            </span>
                          ))
                        : "—"}
                    </td>
                    <td className="num">{r.tavily_searches}</td>
                    <td className="num">{fmt(costs.get(r.id)?.calls)}</td>
                    <td className="num">{usd(costs.get(r.id)?.cost)}</td>
                    <td className="small">
                      {r.errors?.length ? (
                        <details>
                          <summary>{r.errors.length}</summary>
                          {r.errors.map((e, i) => (
                            <div key={i}><b>{e.where}</b>: {e.message}</div>
                          ))}
                        </details>
                      ) : (
                        0
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </main>
    </>
  );
}
