// This week's brief: summary tiles, jump-to topics, paper cards with feedback buttons, "You missed this",
// and the Admin panel (run buttons) at the bottom.
import { q, q1, activeTopics } from "@/lib/db";
import { briefItems, FOOTER, type BriefRow } from "@/lib/brief";
import { istShort } from "@/lib/time";
import { addMissed } from "./actions";
import { Nav } from "./nav";
import { AdminPanel, Notice, PaperCard, RunStatus, Tile, fmt } from "./ui";

export const dynamic = "force-dynamic";

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

  return (
    <>
      <Nav />
      <main className="container">
        <Notice msg={sp.msg} link={sp.link} />

        <div className="page-head">
          <div className="spread" style={{ alignItems: "flex-end" }}>
            <div>
              <div className="small muted">This week&apos;s brief</div>
              <h1>{d ? `Week of ${d.label}` : "Research Pulse"}</h1>
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

        {d && (
          <>
            <div className="tiles">
              <Tile num={d.topline.papers_checked} label="papers checked" sub="new this week" />
              <Tile num={d.topics.length} label="topics covered" sub={`${topicsWithPapers} with on-topic papers`} />
              <Tile num={inBrief} label="papers in this brief" sub="shown in full" />
              <Tile num={d.topline.blogs_checked} label="blogs checked" sub={`${fmt(d.topline.blogs_no_paper)} with no paper`} />
            </div>
            <p className="xsmall faint">
              {d.topline.older_discussed ? `${fmt(d.topline.older_discussed)} older papers discussed this week are listed separately. ` : ""}
              {zeroTopics.length ? `Topics with 0 papers: ${zeroTopics.join(", ")}. ` : "Every topic had papers. "}
              {waiting ? `${fmt(waiting)} still waiting for or failed the relevance check. ` : ""}
              Email {brief?.email_status === "sent" ? `sent ${istShort(brief.sent_at)}` : brief?.email_status ?? "not sent"}.
            </p>

            <nav className="jump" aria-label="Jump to topic">
              {d.topics.map((t) => (
                <a key={t.topic_id} className="chip" href={`#topic-${t.topic_id}`}>{t.name}</a>
              ))}
            </nav>

            {d.topics.map((t) => (
              <section key={t.topic_id} id={`topic-${t.topic_id}`} className="topic">
                <div className="topic-head">
                  <h2>{t.name}</h2>
                  <span className="xsmall faint">{fmt(t.counts.checked)} checked · {fmt(t.counts.relevant)} on-topic</span>
                </div>
                <p className="changing"><b>What&apos;s changing:</b> {t.whats_changing}</p>
                {t.quiet && <p className="quiet">Quiet week — no paper scored 5 or more. Every paper checked is still one click away below.</p>}
                {t.in_brief.map((id) => {
                  const i = byId.get(id);
                  return i ? <PaperCard key={id} i={i} /> : null;
                })}
                {(t.also ?? []).map((id) => {
                  const i = byId.get(id);
                  if (!i) return null;
                  const where = d.topics.find((x) => x.topic_id === i.also_shown_in);
                  return (
                    <p key={id} className="also">
                      Also relevant here: <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
                      {where ? <> (see <a href={`#topic-${where.topic_id}`}>{where.name}</a>)</> : null}
                    </p>
                  );
                })}
                <a className="more-link" href={`/papers?brief=${brief!.id}&topic=${t.topic_id}`}>+ {fmt(t.more_count)} more papers checked →</a>
              </section>
            ))}
            <p className="muted small" style={{ marginTop: 40, textAlign: "center" }}>{FOOTER}</p>
          </>
        )}

        <section className="section" id="missed">
          <div className="card">
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
    </>
  );
}
