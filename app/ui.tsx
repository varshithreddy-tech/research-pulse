// Shared pieces of the dashboard UI. Presentation only — data and behaviour live in lib/ and actions.
import { q1 } from "@/lib/db";
import { TYPE_LABEL, aboutText, facts, olderLabel, whyText, type ItemView } from "@/lib/brief";
import { istShort } from "@/lib/time";
import { toggleMark, runDailyNow, makeBriefNow } from "./actions";
import { AutoRefresh } from "./refresh";

const MARKS: { kind: "read_fully" | "share" | "not_useful"; label: string }[] = [
  { kind: "read_fully", label: "Read fully" },
  { kind: "share", label: "Share with a client" },
  { kind: "not_useful", label: "Not useful" },
];

export const TYPE_BADGE: Record<string, string> = { ...TYPE_LABEL, new_way_to_see_problem: "New way to see a problem" };

export function MarkButtons(props: { paperId: number; itemId: number | null; topicId: number | null; marks: string[] }) {
  return (
    <div className="actions">
      {MARKS.map((m) => {
        const on = props.marks.includes(m.kind);
        return (
          <form key={m.kind} action={toggleMark.bind(null, props.paperId, m.kind, props.itemId, props.topicId)} className="inline">
            <button className={on ? "on" : ""} title={on ? "Saved — click to undo" : undefined} aria-pressed={on}>
              {on ? "✓ " : ""}
              {m.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

/** Status / type / score / older badges for a paper. */
export function PaperBadges(p: {
  type?: string | null;
  score?: number | null;
  pub_status: string;
  venue?: string | null;
  older?: boolean;
  year?: number | null;
  children?: React.ReactNode; // extra badges shown first, on the same row
}) {
  return (
    <div className="badges">
      {p.children}
      {p.type && p.type !== "nothing_new" && <span className="badge type">{TYPE_BADGE[p.type] ?? p.type}</span>}
      <span className={`badge ${p.pub_status === "peer_reviewed" ? "peer" : ""}`} title={p.venue ?? undefined}>
        {p.pub_status === "peer_reviewed" ? "Peer-reviewed" : "Preprint"}
      </span>
      {p.score !== null && p.score !== undefined && <span className="badge score">{p.score}/10 suggested</span>}
      {p.older && <span className="badge older">{olderLabel(p.year ?? null).replace(" — discussed this week", "")}</span>}
    </div>
  );
}

/** Muted facts line: venue, citations, upvotes, code, Discussed in. */
export function FactsLine({ i }: { i: ItemView }) {
  const f = facts(i); // [status, citations, upvotes, code, blogs]
  return (
    <div className="facts">
      {i.pub_status === "peer_reviewed" && i.venue ? `${i.venue} · ` : ""}
      {f[1]} · {f[2]} ·{" "}
      {i.code_url ? (
        <a href={i.code_url} target="_blank" rel="noreferrer">Code shared</a>
      ) : (
        f[3]
      )}
      {i.discussed_in.length > 0 && (
        <>
          {" · Discussed in "}
          {i.discussed_in.map((b, k) => (
            <span key={b.url}>
              {k > 0 && ", "}
              <a href={b.url} target="_blank" rel="noreferrer">{b.title}</a>
            </span>
          ))}
        </>
      )}
    </div>
  );
}

/** A paper shown in full in the brief. */
export function PaperCard({ i }: { i: ItemView }) {
  return (
    <article className="paper">
      <a className="title" href={i.url} target="_blank" rel="noreferrer">{i.title}</a>
      <PaperBadges type={i.type} score={i.score} pub_status={i.pub_status} venue={i.venue} older={i.older} year={i.published_year} />
      <FactsLine i={i} />
      <div className="label">What it&apos;s about</div>
      <p>{aboutText(i)}</p>
      <div className="label">Why it may matter</div>
      <p>{whyText(i)}</p>
      <MarkButtons paperId={i.paper_id} itemId={i.id} topicId={i.topic_id} marks={i.marks} />
    </article>
  );
}

export function Tile({ num, label, sub }: { num: string | number; label: string; sub?: string }) {
  return (
    <div className="tile">
      <div className="tile-num">{typeof num === "number" ? fmt(num) : num}</div>
      <div className="tile-label">{label}</div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

/**
 * The run buttons, their explanation and the live status of the latest runs. Behaviour (one run at a
 * time, daily caps, messages) lives in the server actions; this is only where the buttons sit.
 */
export async function AdminPanel() {
  const daily = await q1<{ id: number; status: string; started_at: string; heartbeat_at: string; trigger: string }>(
    `SELECT id, status, started_at, heartbeat_at, trigger FROM runs WHERE kind = 'daily' ORDER BY id DESC LIMIT 1`,
  );
  const weekly = await q1<{ id: number; status: string; started_at: string; heartbeat_at: string; brief_id: number | null; trigger: string }>(
    `SELECT r.id, r.status, r.started_at, r.heartbeat_at, r.trigger, b.id AS brief_id
     FROM runs r LEFT JOIN briefs b ON b.run_id = r.id WHERE r.kind = 'weekly' ORDER BY r.id DESC LIMIT 1`,
  );
  return (
    <section className="card admin" aria-labelledby="admin-h">
      <h3 id="admin-h">Admin</h3>
      <div className="row" style={{ marginTop: 10 }}>
        <form action={runDailyNow} className="inline">
          <button>Run daily now</button>
        </form>
        <form action={makeBriefNow} className="inline">
          <button>Make brief now</button>
        </form>
      </div>
      <p className="small muted" style={{ marginTop: 10 }}>
        Run daily now collects today&apos;s new papers (takes 3–10 min). Make brief now builds this week&apos;s brief and emails it
        (takes 2–5 min). Scheduled runs happen automatically every day at 6:00 AM IST and Monday 6:30 AM IST.
      </p>
      <div className="small" style={{ marginTop: 10, display: "grid", gap: 4 }}>
        <div>
          <span className="muted">Latest daily run:</span>{" "}
          {daily ? (
            <>
              <a href={`/coverage#run-${daily.id}`}>#{daily.id}</a> · {istShort(daily.started_at)} {triggerLabel(daily.trigger)} ·{" "}
              <RunStatus status={daily.status} heartbeat={daily.heartbeat_at} />
            </>
          ) : (
            "none yet"
          )}
        </div>
        <div>
          <span className="muted">Latest brief run:</span>{" "}
          {weekly ? (
            <>
              <a href={weekly.brief_id ? `/?brief=${weekly.brief_id}` : `/coverage#run-${weekly.id}`}>#{weekly.id}</a> · {istShort(weekly.started_at)}{" "}
              {triggerLabel(weekly.trigger)} · <RunStatus status={weekly.status} heartbeat={weekly.heartbeat_at} />
            </>
          ) : (
            "none yet"
          )}
        </div>
      </div>
    </section>
  );
}

export function triggerLabel(trigger: string): string {
  return trigger === "dashboard" ? "(from button)" : trigger === "cron" ? "(scheduled)" : "(admin API)";
}

/** Message after an action; `link` (same-site path only) points to the related run or brief. */
export function Notice({ msg, link }: { msg?: string; link?: string }) {
  if (!msg) return null;
  const safe = link && link.startsWith("/") && !link.startsWith("//") ? link : null;
  return (
    <div className="notice" role="status">
      {msg}
      {safe && (
        <>
          {" "}
          <a href={safe}>See its live progress →</a>
        </>
      )}
    </div>
  );
}

export function Relevance({ status, relevant }: { status: string; relevant: boolean | null }) {
  if (status === "pending") return <span className="badge warn">Waiting for check</span>;
  if (status === "not_assessed") return <span className="badge bad">Not assessed</span>;
  return relevant ? <span className="badge ok">On-topic</span> : <span className="badge">Not relevant</span>;
}

export function PubStatus({ s, venue }: { s: string; venue?: string | null }) {
  return <span className={`badge ${s === "peer_reviewed" ? "peer" : ""}`} title={venue ?? undefined}>{s === "peer_reviewed" ? "Peer-reviewed" : "Preprint"}</span>;
}

export function RunStatus({ status, heartbeat }: { status: string; heartbeat?: string }) {
  const stale = status === "running" && heartbeat && Date.now() - new Date(heartbeat).getTime() > 15 * 60_000;
  const cls = status === "done" ? "ok" : status === "running" && !stale ? "warn" : status === "partial" ? "warn" : "bad";
  return (
    <>
      <span className={`badge ${cls}`}>{stale ? "stalled" : status}</span>
      {status === "running" && !stale && <AutoRefresh seconds={15} />}
    </>
  );
}

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");
export const usd = (n: number | string | null | undefined, digits = 4) => `$${Number(n ?? 0).toFixed(digits)}`;
