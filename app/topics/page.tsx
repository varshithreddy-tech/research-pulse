// Topics: Kavita adds, edits and pauses topics here — no code. Gemini reads this list before every judgment.
import { allTopics, q, type Topic } from "@/lib/db";
import { describeChanges, type Changes } from "@/lib/topicLog";
import { istShort } from "@/lib/time";
import { saveTopic, setTopicActive } from "../actions";
import { Nav } from "../nav";
import { Notice } from "../ui";

export const dynamic = "force-dynamic";

function TopicForm({ t }: { t?: Topic }) {
  return (
    <form action={saveTopic}>
      {t && <input type="hidden" name="id" value={t.id} />}
      <label>Topic name</label>
      <input name="name" defaultValue={t?.name} required style={{ width: "100%" }} />
      <label>What she cares about (plain words — Gemini judges relevance from this)</label>
      <textarea name="focus" defaultValue={t?.focus} rows={3} required />
      <label>arXiv categories (comma separated, e.g. cs.CL, cs.AI) — every paper in these is checked</label>
      <input name="arxiv_categories" defaultValue={t?.arxiv_categories.join(", ")} required style={{ width: "100%" }} />
      <label>Search words (comma separated) — used for Tavily and as a hint to Gemini, never to filter arXiv</label>
      <input name="search_words" defaultValue={t?.search_words.join(", ")} style={{ width: "100%" }} />
      <p><button className="primary">{t ? "Save changes" : "Add topic"}</button></p>
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
    <>
      <Nav />
      <main>
        <Notice msg={sp.msg} />
        <h1>Topics</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Anyone with the link can edit topics; every change is logged below. Changes apply from the next run. A new topic (or new
          categories) also queues the last 7 days of papers in those categories.
          Common categories: cs.AI, cs.CL, cs.LG, cs.CV, cs.IR, cs.SE, cs.CR, cs.RO, cs.MA, cs.PL, cs.MM, eess.IV, stat.ML.
        </p>
        {topics.map((t) => (
          <div key={t.id} className="card">
            <div className="spread">
              <b>{t.name}</b>
              <div className="row">
                <span className={`tag ${t.active ? "ok" : ""}`}>{t.active ? "Active" : "Paused"}</span>
                <form action={setTopicActive.bind(null, t.id, !t.active)} className="inline">
                  <button>{t.active ? "Pause" : "Resume"}</button>
                </form>
              </div>
            </div>
            <div className="small muted">{t.arxiv_categories.join(", ")} · {t.search_words.join(", ")}</div>
            <details>
              <summary className="small">Edit</summary>
              <TopicForm t={t} />
            </details>
          </div>
        ))}
        <h2>Add a topic</h2>
        <div className="card">
          <TopicForm />
        </div>
        <h2 id="log">Change log</h2>
        {log.length === 0 && <div className="card muted small">No topic changes yet.</div>}
        {log.length > 0 && (
          <div className="scroll">
            <table>
              <thead><tr><th>When (IST)</th><th>Topic</th><th>Change</th><th>What changed</th></tr></thead>
              <tbody>
                {log.map((c) => (
                  <tr key={c.id}>
                    <td>{istShort(c.created_at)}</td>
                    <td>{c.topic_name}</td>
                    <td>{c.action}</td>
                    <td>{describeChanges(c.action, c.changes).map((l, i) => <div key={i}>{l}</div>)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </>
  );
}
