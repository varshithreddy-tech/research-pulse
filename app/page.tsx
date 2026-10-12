// This week's brief: pastel hero with tiles, a topic overview grid, and one topic at a time (picked
// here or from the left sidebar) — plus "You missed this" and the Admin panel.
import { q, q1, activeTopics } from "@/lib/db";
import { briefItems, FOOTER, type BriefRow, type DashboardTopic, type ItemView } from "@/lib/brief";
import { istShort } from "@/lib/time";
import { addMissed } from "./actions";
import { Shell } from "./shell";
import { TopicExplorer } from "./explorer";
import { pc } from "./palette";
import { AdminPanel, Notice, PaperCard, RunStatus, Tile, fmt } from "./ui";

export const dynamic = "force-dynamic";

function TopicPanel({ t, byId, briefId, all }: { t: DashboardTopic; byId: Map<number, ItemView>; briefId: number; all: DashboardTopic[] }) {
  return (
    <section className={pc(t.topic_id)} aria-label={t.name}>
      <div className="topic-band">
        <h2><span className="dot" style={{ width: 12, height: 12 }} />{t.name}</h2>
        <div className="meta">{fmt(t.counts.checked)} papers checked · {fmt(t.counts.relevant)} on-topic · {t.in_brief.length} shown in full</div>
        <p className="changing"><b>What&apos;s changing:</b> {t.whats_changing}</p>
      </div>
      {t.quiet && <p className="quiet">Quiet week — no paper scored 5 or more. Every paper checked is still one click away below.</p>}
      {t.in_brief.map((id) => {
        const i = byId.get(id);
        return i ? <PaperCard key={id} i={i} /> : null;
      })}
      {(t.also ?? []).map((id) => {
        const i = byId.get(id);
        if (!i) return null;
        const where = all.find((x) => x.topic_id === i.also_shown_in);
        return (
          <p key={id} className="also">
            <span>↪</span>
            <span>
              Also relevant here: <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
              {where ? <> (see <a href={`#t-${where.topic_id}`}>{where.name}</a>)</> : null}
            </span>
          </p>
        );
      })}
      <a className="more-link" href={`/papers?brief=${briefId}&topic=${t.topic_id}`}>+ {fmt(t.more_count)} more papers checked →</a>
    </section>
  );
}

export default async function BriefPage({ searchParams }: { searchParams: Promise<{ brief?: string; msg?: string; link?: string }> }) {
  const sp = await searchParams;
  const briefs = await q<{ id: number; status: string; created_at: string }>(`SELECT id, status, created_at FROM briefs ORDER BY id DESC LIMIT 30`);
  const selectedId = Number(sp.brief) || briefs.find((b) => b.status === "done")?.id || briefs[0]?.id;
  const brief = selectedId ? await q1<BriefRow>(`SELECT * FROM briefs WHERE id = $1`, [selectedId]) : null;
  const topics = await activeTopics();
  const items = brief?.dashboard_json ? await briefItems(brief.id, true) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const d = brief?.dashboard_json;
  const inBrief = new Set(items.filter((i) => i.in_brief).map((i) => i.paper_id)).size;
  const topicsWithPapers = d ? d.topics.filter((t) => t.counts.relevant > 0).length : 0;
  const waiting = d ? d.topline.topics.reduce((s, t) => s + t.pending + t.not_assessed, 0) : 0;
  const zeroTopics = d ? d.topline.topics.filter((t) => t.checked === 0).map((t) => t.name) : [];

  const overview = d ? (
    <div className="topic-grid">
      {d.topics.map((t) => {
        const top = byId.get(t.in_brief[0]);
        return (
          <a key={t.topic_id} href={`#t-${t.topic_id}`} className={`topic-card ${pc(t.topic_id)}`}>
            <span className="tc-name"><span className="dot" />{t.name}</span>
            <span className="tc-change">{t.whats_changing}</span>
            {top && <span className="tc-top"><b>Top paper:</b> {top.title}</span>}
            {!top && t.quiet && <span className="tc-top">Quiet week — no paper scored 5+</span>}
            <span className="tc-meta">{t.in_brief.length} in full · {fmt(t.counts.relevant)} on-topic · {fmt(t.counts.checked)} checked → open</span>
          </a>
        );
      })}
    </div>
  ) : null;

  return (
    <Shell>
      <main className="container">
        <Notice msg={sp.msg} link={sp.link} />

        <div className="hero">
          <div className="spread" style={{ alignItems: "flex-start" }}>
            <div>
              <div className="eyebrow">This week&apos;s brief</div>
              <h1>{d ? `Week of ${d.label}` : "Research Pulse"}</h1>
              {d && (
                <p className="small muted" style={{ marginTop: 6 }}>
                  Email {brief?.email_status === "sent" ? `sent ${istShort(brief.sent_at)}` : brief?.email_status ?? "not sent"} ·{" "}
                  <a href="/email-preview">preview the email</a>
                </p>
              )}
            </div>
            {briefs.length > 1 && (
              <form className="row small" aria-label="Open an earlier brief">
                <label htmlFor="brief" className="muted" style={{ margin: 0 }}>Archive</label>
                <select id="brief" name="brief" defaultValue={selectedId}>
                  {briefs.map((b) => (
                    <option key={b.id} value={b.id}>
                      Brief #{b.id} · {istShort(b.created_at)}{b.status === "done" ? "" : ` · ${b.status}`}
                    </option>
                  ))}
                </select>
                <button>Open</button>
              </form>
            )}
          </div>
          {d && (
            <>
              <div className="tiles">
                <Tile tone={0} num={d.topline.papers_checked} label="papers checked" sub="new this week" />
                <Tile tone={1} num={d.topics.length} label="topics covered" sub={`${topicsWithPapers} with on-topic papers`} />
                <Tile tone={2} num={inBrief} label="papers in this brief" sub="shown in full" />
                <Tile tone={3} num={d.topline.blogs_checked} label="blogs checked" sub={`${fmt(d.topline.blogs_no_paper)} with no paper`} />
              </div>
              <p className="xsmall muted" style={{ marginTop: 12 }}>
                {d.topline.older_discussed ? `${fmt(d.topline.older_discussed)} older papers discussed this week are listed separately. ` : ""}
                {zeroTopics.length ? `Topics with 0 papers: ${zeroTopics.join(", ")}. ` : "Every topic had papers. "}
                {waiting ? `${fmt(waiting)} still waiting for or failed the relevance check.` : ""}
              </p>
            </>
          )}
        </div>

        {!brief && (
          <div className="card empty">
            <div className="big">📭</div>
            No brief yet. The first one is made on Monday at 6:30 AM IST — or use “Make brief now” in the Admin panel below.
          </div>
        )}

        {brief && brief.status !== "done" && (
          <div className="notice warn">
            Brief #{brief.id} {brief.status === "failed" ? "failed — see Cost & coverage → recent runs for the error." : <>is being made — step: <b>{brief.status}</b> </>}
            {brief.status !== "failed" && <RunStatus status="running" heartbeat={new Date().toISOString()} />}
          </div>
        )}

        {d && brief && (
          <>
            <TopicExplorer
              topics={d.topics.map((t) => ({ id: t.topic_id, name: t.name }))}
              overview={overview}
              panels={Object.fromEntries(d.topics.map((t) => [String(t.topic_id), <TopicPanel key={t.topic_id} t={t} byId={byId} briefId={brief.id} all={d.topics} />]))}
            />
            <p className="muted small" style={{ marginTop: 36, textAlign: "center", fontStyle: "italic" }}>{FOOTER}</p>
          </>
        )}

        <section className="section" id="missed">
          <div className="card pc-5" style={{ background: "linear-gradient(135deg, var(--p5-bg), var(--surface) 70%)" }}>
            <h2>You missed this?</h2>
            <p className="small muted" style={{ marginTop: 6 }}>
              Saw an important paper the system didn&apos;t surface? Add it here — it&apos;s counted (target: 0) and checked in the next run.
            </p>
            <form action={addMissed}>
              <label htmlFor="url">Paper link</label>
              <input id="url" name="url" type="url" required placeholder="arXiv, DOI, OpenReview, ACL, CVF, IEEE or ACM link" style={{ width: "100%" }} />
              <div className="row" style={{ marginTop: 4, alignItems: "flex-end" }}>
                <div style={{ flex: "1 1 220px" }}>
                  <label htmlFor="topic_id">Topic</label>
                  <select id="topic_id" name="topic_id" required defaultValue="" style={{ width: "100%" }}>
                    <option value="" disabled>Choose a topic…</option>
                    {topics.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
                <div style={{ flex: "2 1 260px" }}>
                  <label htmlFor="note">Note (optional)</label>
                  <input id="note" name="note" style={{ width: "100%" }} />
                </div>
              </div>
              <p style={{ marginTop: 14 }}><button className="primary">Save “You missed this”</button></p>
            </form>
          </div>
        </section>

        <AdminPanel />
      </main>
    </Shell>
  );
}
