// This week's brief: top 3 per topic with mark buttons, "+ N more" links, "You missed this" form.
import { q, q1, activeTopics } from "@/lib/db";
import { aboutText, briefItems, cardFacts, olderLabel, toplineText, FOOTER, type BriefRow } from "@/lib/brief";
import { istShort } from "@/lib/time";
import { addMissed } from "./actions";
import { Nav } from "./nav";
import { AdminButtons, MarkButtons, Notice, RunStatus } from "./ui";

export const dynamic = "force-dynamic";

export default async function BriefPage({ searchParams }: { searchParams: Promise<{ brief?: string; msg?: string }> }) {
  const sp = await searchParams;
  const briefs = await q<{ id: number; week_start: string; week_end: string; status: string; created_at: string }>(
    `SELECT id, week_start, week_end, status, created_at FROM briefs ORDER BY id DESC LIMIT 30`,
  );
  const selectedId = Number(sp.brief) || briefs.find((b) => b.status === "done")?.id || briefs[0]?.id;
  const brief = selectedId ? await q1<BriefRow>(`SELECT * FROM briefs WHERE id = $1`, [selectedId]) : null;
  const latestDaily = await q1<{ id: number; status: string; started_at: string; heartbeat_at: string }>(
    `SELECT id, status, started_at, heartbeat_at FROM runs WHERE kind = 'daily' ORDER BY id DESC LIMIT 1`,
  );
  const topics = await activeTopics();
  const items = brief?.dashboard_json ? await briefItems(brief.id, true) : [];
  const byId = new Map(items.map((i) => [i.id, i]));
  const d = brief?.dashboard_json;

  return (
    <>
      <Nav />
      <main>
        <Notice msg={sp.msg} />
        <div className="spread">
          <div>
            <h1>This week&apos;s brief</h1>
            {d && <div className="muted">Week of {d.label}</div>}
          </div>
          <AdminButtons />
        </div>
        <div className="small muted" style={{ marginTop: 6 }}>
          Last daily run: {latestDaily ? <>#{latestDaily.id} {istShort(latestDaily.started_at)} <RunStatus status={latestDaily.status} heartbeat={latestDaily.heartbeat_at} /></> : "none yet"}
          {briefs.length > 1 && (
            <form className="inline" style={{ marginLeft: 16 }}>
              Archive:{" "}
              <select name="brief" defaultValue={selectedId}>
                {briefs.map((b) => (
                  <option key={b.id} value={b.id}>
                    #{b.id} · {istShort(b.created_at)} · {b.status}
                  </option>
                ))}
              </select>{" "}
              <button>Open</button>
            </form>
          )}
        </div>

        {!brief && <div className="card">No brief yet. The first one is made on Monday at 6:30 AM IST — or press “Make brief now”.</div>}

        {brief && brief.status !== "done" && (
          <div className="card">
            Brief #{brief.id} is {brief.status === "failed" ? "" : "being made — step: "}
            <RunStatus status={brief.status === "failed" ? "failed" : "running"} heartbeat={new Date().toISOString()} />{" "}
            {brief.status !== "failed" && <b>{brief.status}</b>}
            {brief.status === "failed" && <span className="small"> See Cost &amp; coverage → runs for the error.</span>}
          </div>
        )}

        {d && (
          <>
            <div className="card small">
              {toplineText(d.topline).map((l) => (
                <div key={l}>{l}</div>
              ))}
              <div className="muted" style={{ marginTop: 4 }}>
                Email: {brief?.email_status ?? "—"}
                {brief?.sent_at ? ` (${istShort(brief.sent_at)})` : ""} · written by {brief?.written_by ?? "—"}
              </div>
            </div>

            {d.topics.map((t) => (
              <section key={t.topic_id}>
                <h2>{t.name}</h2>
                <p style={{ margin: "4px 0 8px" }}>
                  <b>What&apos;s changing:</b> {t.whats_changing}
                </p>
                {t.quiet && <p className="muted"><b>Quiet week</b> — no paper scored 5 or more.</p>}
                {t.in_brief.map((id) => {
                  const i = byId.get(id);
                  if (!i) return null;
                  return (
                    <div key={id} className="paper">
                      <a className="title" href={i.url} target="_blank" rel="noreferrer">
                        {i.title}
                      </a>
                      {i.older && <div className="small" style={{ color: "var(--warn)" }}>{olderLabel(i.published_year)}</div>}
                      <div className="facts">
                        {cardFacts(i).join(" · ")}
                        {i.code_url && (
                          <>
                            {" · "}
                            <a href={i.code_url} target="_blank" rel="noreferrer">code</a>
                          </>
                        )}
                      </div>
                      <p style={{ margin: "6px 0 2px" }}>
                        <b>What it&apos;s about:</b> {aboutText(i)}
                      </p>
                      <p style={{ margin: "2px 0" }}>
                        <b>Why it may matter:</b> {i.reason_line2}
                      </p>
                      <MarkButtons paperId={i.paper_id} itemId={i.id} topicId={i.topic_id} marks={i.marks} />
                    </div>
                  );
                })}
                {(t.also ?? []).map((id) => {
                  const i = byId.get(id);
                  if (!i) return null;
                  const where = d.topics.find((x) => x.topic_id === i.also_shown_in)?.name ?? "another topic";
                  return (
                    <p key={id} className="small" style={{ margin: "6px 0" }}>
                      Also relevant here: <a href={i.url} target="_blank" rel="noreferrer">{i.title}</a> (see {where})
                    </p>
                  );
                })}
                <a href={`/papers?brief=${brief!.id}&topic=${t.topic_id}`}>+ {t.more_count} more papers checked</a>
              </section>
            ))}
            <p className="muted" style={{ marginTop: 28 }}>{FOOTER}</p>
          </>
        )}

        <h2 id="missed">You missed this</h2>
        <form action={addMissed} className="card">
          <p className="small muted" style={{ marginTop: 0 }}>
            Saw an important paper the system didn&apos;t surface? Add it here. It is counted (target: 0) and checked in the next run.
          </p>
          <div className="row">
            <input name="url" type="url" required placeholder="Paper link (arXiv, DOI, OpenReview, ACL, CVF, IEEE, ACM…)" style={{ flex: 1, minWidth: 260 }} />
            <select name="topic_id" required defaultValue="">
              <option value="" disabled>Topic…</option>
              {topics.map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </select>
          </div>
          <label htmlFor="note">Note (optional)</label>
          <input id="note" name="note" style={{ width: "100%" }} />
          <p><button className="primary">Save “You missed this”</button></p>
        </form>
      </main>
    </>
  );
}
