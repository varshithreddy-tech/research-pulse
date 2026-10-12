// Topics: add, edit and pause topics — no code. Gemini reads this list before every judgment.
// Anyone with the link can edit, so every change is logged below.
import { allTopics, q, type Topic } from "@/lib/db";
import { describeChanges, type Changes } from "@/lib/topicLog";
import { istShort } from "@/lib/time";
import { saveTopic, setTopicActive } from "../actions";
import { Shell } from "../shell";
import { Notice } from "../ui";
import { pc } from "../palette";

export const dynamic = "force-dynamic";

function TopicForm({ t }: { t?: Topic }) {
  const id = t ? `t${t.id}` : "new";
  return (
    <form action={saveTopic}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <label htmlFor={`${id}-name`}>Topic name</label>
      <input id={`${id}-name`} name="name" defaultValue={t?.name} required style={{ width: "100%" }} />
      <label htmlFor={`${id}-focus`}>What she cares about — plain words; Gemini judges relevance from this</label>
      <textarea id={`${id}-focus`} name="focus" defaultValue={t?.focus} rows={3} required />
      <label htmlFor={`${id}-cats`}>arXiv categories, comma separated — every paper in these is checked</label>
      <input id={`${id}-cats`} name="arxiv_categories" defaultValue={t?.arxiv_categories.join(", ")} placeholder="cs.CL, cs.AI" required style={{ width: "100%" }} />
      <label htmlFor={`${id}-words`}>Search words, comma separated — used for Tavily and as a hint, never to filter arXiv</label>
      <input id={`${id}-words`} name="search_words" defaultValue={t?.search_words.join(", ")} style={{ width: "100%" }} />
      <p style={{ marginTop: 14 }}><button className="primary">{t ? "Save changes" : "Add topic"}</button></p>
    </form>
  );
}

export default async function TopicsPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const sp = await searchParams;
  const topics = await allTopics();
  const log = await q<{ id: number; topic_name: string; action: string; changes: Changes; created_at: string }>(
    `SELECT id, topic_name, action, changes, created_at FROM topic_changes ORDER BY id DESC LIMIT 50`,
  );
  return (
    <Shell>
      <main className="container">
        <Notice msg={sp.msg} />
        <div className="page-head hero">
          <div className="eyebrow">What Kavita follows</div>
          <h1>Topics</h1>
          <p className="sub">
            {topics.filter((t) => t.active).length} active · changes apply from the next run. Anyone with the link can edit; every change is logged below.
          </p>
        </div>

        {topics.map((t) => (
          <article key={t.id} className={`card ${pc(t.id)}`} style={{ borderTop: "5px solid var(--pc-dot)", ...(t.active ? {} : { opacity: 0.7 }) }}>
            <div className="spread" style={{ alignItems: "flex-start" }}>
              <h2 style={{ fontSize: 18, display: "flex", alignItems: "center", gap: 10 }}><span className="dot" style={{ width: 12, height: 12 }} />{t.name}</h2>
              <form action={setTopicActive.bind(null, t.id, !t.active)} className="inline">
                <button className={`switch ${t.active ? "on" : ""}`} aria-pressed={t.active} title={t.active ? "Click to pause this topic" : "Click to resume this topic"}>
                  <span className="track" />
                  {t.active ? "Active" : "Paused"}
                </button>
              </form>
            </div>
            <p className="small" style={{ marginTop: 8 }}>{t.focus}</p>
            <div className="label">arXiv categories</div>
            <div className="chips">{t.arxiv_categories.map((c) => <span key={c} className="chip soft">{c}</span>)}</div>
            <div className="label">Search words</div>
            <div className="chips">
              {t.search_words.length ? t.search_words.map((w) => <span key={w} className="chip">{w}</span>) : <span className="xsmall faint">none</span>}
            </div>
            <details style={{ marginTop: 14 }}>
              <summary>Edit this topic</summary>
              <TopicForm t={t} />
            </details>
          </article>
        ))}

        <section className="section">
          <div className="card">
            <h2>Add a topic</h2>
            <p className="xsmall faint" style={{ marginTop: 4 }}>
              A new topic (or new categories) also queues the last 7 days of papers in those categories. Common categories: cs.AI, cs.CL,
              cs.LG, cs.CV, cs.IR, cs.SE, cs.CR, cs.RO, cs.MA, cs.PL, cs.MM, eess.IV, stat.ML.
            </p>
            <TopicForm />
          </div>
        </section>

        <section className="section" id="log">
          <div className="section-head"><h2>Change log</h2><span className="xsmall faint">latest 50</span></div>
          {log.length === 0 ? (
            <div className="card empty">No topic changes yet.</div>
          ) : (
            <div className="table-wrap">
              <table className="stack-mobile">
                <thead><tr><th>When (IST)</th><th>Topic</th><th>Change</th><th>What changed</th></tr></thead>
                <tbody>
                  {log.map((c) => (
                    <tr key={c.id}>
                      <td data-label="When" className="small">{istShort(c.created_at)}</td>
                      <td data-label="Topic" className="small">{c.topic_name}</td>
                      <td data-label="Change"><span className="badge">{c.action}</span></td>
                      <td data-label="What" className="small">{describeChanges(c.action, c.changes).map((l, i) => <div key={i}>{l}</div>)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </Shell>
  );
}
