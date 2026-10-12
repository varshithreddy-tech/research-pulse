// This week's brief, answer first: the week in 30 seconds → the (at most) 3 papers to bring to a
// client → each topic with its picked papers as one-line rows (details open on click) → a right rail
// with the client shortlist, where the volume is, and "You missed this?". Admin stays at the bottom.
import { q, q1, activeTopics } from "@/lib/db";
import { briefItems, funnelLine, labText, whyText, FOOTER, type BriefRow, type ItemView } from "@/lib/brief";
import { briefNumbers, topicMomentum } from "@/lib/numbers";
import { istShort } from "@/lib/time";
import { addMissed } from "./actions";
import { Shell } from "./shell";
import { Headline, PulseLine } from "./landing";
import { pc } from "./palette";
import { AdminPanel, EvidenceMeter, MarkButtons, Notice, PaperRow, RunStatus, TierPill, fmt } from "./ui";

export const dynamic = "force-dynamic";

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 64;
  const h = 18;
  const pts = values.map((v, i) => `${((i / Math.max(1, values.length - 1)) * w).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <polyline points={pts} fill="none" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
  const name = new Map((d?.topics ?? []).map((t) => [t.topic_id, t.name]));
  const topicName = (id: number) => name.get(id);
  const numbers = d ? d.numbers ?? briefNumbers(d.topline, items.filter((i) => i.in_brief)) : null;
  const top = (d?.top ?? []).map((id) => byId.get(id)).filter((i): i is ItemView => !!i);
  const momentum = brief ? await topicMomentum(brief.week_start) : null;
  const shortlist = await q<{ paper_id: number; title: string; topic: string | null; topic_id: number | null }>(
    `SELECT p.id AS paper_id, p.title, t.name AS topic, m.topic_id FROM marks m JOIN papers p ON p.id = m.paper_id
     LEFT JOIN topics t ON t.id = m.topic_id WHERE m.kind = 'share' ORDER BY m.created_at DESC LIMIT 6`,
  );
  const shortCount = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM marks WHERE kind = 'share'`);
  const missedCount = brief
    ? await q1<{ n: number }>(`SELECT count(*)::int AS n FROM marks WHERE kind = 'missed' AND created_at >= $1 AND created_at < $2`, [brief.week_start, brief.week_end])
    : null;

  const volume = (d?.topics ?? [])
    .map((t) => {
      const series = momentum?.byTopic.get(t.topic_id) ?? [];
      const now = numbers?.topics.find((x) => x.topic_id === t.topic_id)?.on_topic ?? t.counts.relevant;
      const prev = series.length > 1 ? series[series.length - 2] : 0;
      return { t, now, prev, series, scanned: t.counts.checked };
    })
    .sort((a, b) => b.now - a.now);
  const maxVol = Math.max(1, ...volume.map((v) => v.now));

  return (
    <Shell>
      <div className="brief-layout">
        <main className="brief-main">
          <Notice msg={sp.msg} link={sp.link} />

          <header className="hero masthead">
            <div className="topbar">
              <div>
                <div className="eyebrow">Monday Brief{brief ? ` · No. ${brief.id}` : ""}</div>
                <Headline text={d ? `Week of ${d.label}` : "Research Pulse"} />
                {d && numbers && (
                  <div className="meta">
                    {d.read_minutes ? <span><b>~{d.read_minutes} min</b> read</span> : null}
                    <span><b>{top.length}</b> to bring to a client</span>
                    <span title="Unique papers. Papers can fit more than one topic.">
                      <a href={`/papers?brief=${brief!.id}&status=scanned`}>{fmt(numbers.scanned)} scanned</a> →{" "}
                      <a href={`/papers?brief=${brief!.id}&status=on_topic`}>{fmt(numbers.on_topic)} on her topics</a> →{" "}
                      <a href={`/papers?brief=${brief!.id}&status=picked`}>{fmt(numbers.picked)} picked</a>
                    </span>
                    <span>
                      {brief?.email_status === "sent" ? `Emailed ${istShort(brief.sent_at)}` : `Email ${brief?.email_status ?? "not sent"}`} ·{" "}
                      <a href="/email-preview">preview</a>
                    </span>
                  </div>
                )}
              </div>
              {briefs.length > 1 && (
                <form className="row small archive" aria-label="Open an earlier brief">
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
            {d && <PulseLine />}
          </header>

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
              {d.summary && d.summary.length > 0 && (
                <section className="card tldr" aria-labelledby="tldr-h">
                  <h2 id="tldr-h">This week in 30 seconds</h2>
                  <ol>
                    {d.summary.map((s, k) => (
                      <li key={k}>
                        <b>{s.lead}</b> {s.detail}{" "}
                        {s.topic_ids.map((id) => (
                          <a key={id} href={`#t-${id}`} className={`ttag ${pc(id)}`}><span className="dot" />{topicName(id)}</a>
                        ))}
                      </li>
                    ))}
                  </ol>
                </section>
              )}

              {top.length > 0 && (
                <section className="section" aria-labelledby="t1-h">
                  <div className="sec-head">
                    <h2 id="t1-h">Bring to a client</h2>
                    <p>At most 3 a week, across all topics</p>
                  </div>
                  <div className="signals">
                    {top.map((i) => (
                      <article key={i.id} className={`sig ${pc(i.topic_id)}`}>
                        <div className="sig-top">
                          <TierPill tier={1} />
                          <a href={`#t-${i.topic_id}`} className="ttag"><span className="dot" />{topicName(i.topic_id)}</a>
                        </div>
                        <h3><a href={i.url} target="_blank" rel="noreferrer">{i.title}</a></h3>
                        {labText(i) && <div className="lab">{labText(i)}</div>}
                        {i.say ? (
                          <div className="say"><small>Say it in the meeting</small>{i.say}</div>
                        ) : (
                          <div className="say"><small>Why it matters</small>{whyText(i)}</div>
                        )}
                        {i.audience && <div className="who"><b>Who it matters to:</b> {i.audience}</div>}
                        <div className="sig-foot">
                          <EvidenceMeter level={i.evidence} />
                          <MarkButtons compact paperId={i.paper_id} itemId={i.id} topicId={i.topic_id} marks={i.marks} />
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              <section className="section" aria-labelledby="bt-h">
                <div className="sec-head">
                  <h2 id="bt-h">By topic</h2>
                  <p>Up to 3 per topic · papers can fit more than one topic, each is shown once · everything else is one click away</p>
                </div>
                {d.topics.map((t) => {
                  const n = numbers?.topics.find((x) => x.topic_id === t.topic_id);
                  return (
                    <section key={t.topic_id} id={`t-${t.topic_id}`} className={`domain ${pc(t.topic_id)}`} aria-label={t.name}>
                      <div className="domain-head">
                        <h3><span className="dot" />{t.name}</h3>
                        <div className="counts">
                          {fmt(n?.on_topic ?? t.counts.relevant)} on-topic of {fmt(n?.scanned ?? t.counts.checked)} scanned
                        </div>
                      </div>
                      <p className="changing"><b>What&apos;s changing:</b> {t.whats_changing}</p>
                      {t.themes && t.themes.length > 0 && (
                        <div className="themes" aria-label="Recurring themes">
                          {t.themes.map((th) => (
                            <span key={th.tag} className="theme" title={th.recurring ? "Also a theme last week" : "New this week"}>
                              {th.recurring && <span aria-label="recurring">↻ </span>}{th.tag}
                            </span>
                          ))}
                        </div>
                      )}
                      {t.quiet && <p className="quiet">Quiet week — no paper scored high enough to pick. Every on-topic paper is still one click away below.</p>}
                      {t.in_brief.map((id) => {
                        const i = byId.get(id);
                        return i ? <PaperRow key={id} i={i} topicName={topicName} /> : null;
                      })}
                      <a className="more-link" href={`/papers?brief=${brief!.id}&topic=${t.topic_id}&status=more`}>
                        + {fmt(t.more_count)} more on-topic papers →
                      </a>
                    </section>
                  );
                })}
              </section>

              <div className="brief-footer">
                <span>
                  {numbers ? `${funnelLine(numbers)}. ` : ""}Nothing is hidden: <a href={`/papers?brief=${brief!.id}`}>see every paper</a>.
                </span>
                <span>{FOOTER}</span>
              </div>
            </>
          )}

          <AdminPanel />
        </main>

        <aside className="rail" aria-label="Shortlist, volume and missed papers">
          <div className="rail-inner">
            <section className="card rail-card">
              <h3>Client shortlist <span>{fmt(shortCount?.n)}</span></h3>
              {shortlist.length ? (
                shortlist.map((s) => (
                  <div key={s.paper_id} className="short">
                    {s.title.length > 80 ? `${s.title.slice(0, 78)}…` : s.title}
                    <small className={pc(s.topic_id ?? 0)}><span className="dot" />{s.topic ?? "—"}</small>
                  </div>
                ))
              ) : (
                <p className="note">Nothing shortlisted yet. Press “Share” on a paper.</p>
              )}
              <a className="btn wide" href="/shortlist">Tag &amp; export as one-pager</a>
            </section>

            {d && (
              <section className="card rail-card">
                <h3>Where the volume is <span>on-topic papers</span></h3>
                {volume.map((v) => (
                  <a key={v.t.topic_id} href={`#t-${v.t.topic_id}`} className={`mbar ${pc(v.t.topic_id)}`} title={`${v.t.name}: ${v.now} on-topic of ${v.scanned} scanned`}>
                    <span className="lbl">{v.t.name}</span>
                    <span className="track"><span className="fill" style={{ width: `${(v.now / maxVol) * 100}%` }} /></span>
                    <span className="v">{fmt(v.now)}</span>
                    {momentum?.hasHistory && (
                      <span className="trend">
                        <Sparkline values={v.series} />
                        <span className={v.now >= v.prev ? "up" : "down"}>
                          {v.now === v.prev ? "=" : v.now > v.prev ? `▲ ${v.now - v.prev}` : `▼ ${v.prev - v.now}`} vs last week
                        </span>
                      </span>
                    )}
                  </a>
                ))}
                <p className="note">
                  {momentum?.hasHistory ? "Bars: this week. Line: the last 6 weeks." : "Trend builds from next week, once there is a previous week to compare."}{" "}
                  Papers can fit more than one topic.
                </p>
              </section>
            )}

            <section className="card rail-card" id="missed">
              <h3>Did we miss something?</h3>
              <p className="note" style={{ margin: "0 0 8px" }}>
                Paste a paper link; it&apos;s checked in the next run. Misses this week: <b>{fmt(missedCount?.n)}</b>
              </p>
              <form action={addMissed}>
                <input name="url" type="url" required placeholder="arXiv, DOI, OpenReview… link" aria-label="Paper link" style={{ width: "100%" }} />
                <select name="topic_id" required defaultValue="" aria-label="Topic" style={{ width: "100%", marginTop: 8 }}>
                  <option value="" disabled>Choose a topic…</option>
                  {topics.map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
                <input name="note" placeholder="Note (optional)" aria-label="Note" style={{ width: "100%", marginTop: 8 }} />
                <button className="primary wide" style={{ marginTop: 10 }}>Add a missed paper</button>
              </form>
            </section>
          </div>
        </aside>
      </div>
    </Shell>
  );
}
