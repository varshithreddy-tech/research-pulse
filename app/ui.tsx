// Shared pieces of the dashboard UI. Presentation only — data and behaviour live in lib/ and actions.
import { q1 } from "@/lib/db";
import { TYPE_LABEL, aboutText, evidenceLabel, labText, olderLabel, signals, whyText, type ItemView } from "@/lib/brief";
import { TIER_LABEL, type Tier } from "@/lib/steps/rank";
import { istShort } from "@/lib/time";
import { runDailyNow, makeBriefNow } from "./actions";
import { MarkButtons } from "./marks";
import { AutoRefresh } from "./refresh";
import { pc } from "./palette";

export { MarkButtons };

export const TYPE_BADGE: Record<string, string> = { ...TYPE_LABEL, new_way_to_see_problem: "New way to see a problem" };

/** Status / type / older badges for a paper (pastel). The 0–10 score is internal and never shown. */
export function PaperBadges(p: {
  type?: string | null;
  pub_status: string;
  venue?: string | null;
  older?: boolean;
  year?: number | null;
  children?: React.ReactNode; // extra badges shown first, on the same row
}) {
  return (
    <div className="badges">
      {p.children}
      {p.type && p.type !== "nothing_new" && <span className={`badge type-${p.type}`}>{TYPE_BADGE[p.type] ?? p.type}</span>}
      <span className={`badge ${p.pub_status === "peer_reviewed" ? "peer" : ""}`} title={p.venue ?? undefined}>
        {p.pub_status === "peer_reviewed" ? "Peer-reviewed" : "Preprint"}
      </span>
      {p.older && <span className="badge older">{olderLabel(p.year ?? null).replace(" — discussed this week", "")}</span>}
    </div>
  );
}

/** Bring to a client · Read this week · Just so you know. */
export function TierPill({ tier }: { tier: Tier | null | undefined }) {
  if (!tier) return null;
  return <span className={`tier t${tier}`}>{TIER_LABEL[tier]}</span>;
}

/** How strong the evidence is: Lab result → Benchmark → Real deployment, as a 3-step meter. */
export function EvidenceMeter({ level }: { level: number | null | undefined }) {
  const label = evidenceLabel(level ?? null);
  if (!label || !level) return null;
  return (
    <span className="maturity" title={`How strong the evidence is: ${label} (Lab result → Benchmark → Real deployment)`}>
      <span className="meter" aria-hidden="true">
        {[1, 2, 3].map((k) => <i key={k} className={k <= level ? "on" : ""} />)}
      </span>
      {label}
    </span>
  );
}

/** One collapsible paper row: tier · title · lab · one "why it matters" line; details open on click. */
export function PaperRow({ i, topicName }: { i: ItemView; topicName: (id: number) => string | undefined }) {
  const lab = labText(i);
  const sig = signals(i);
  const also = i.also_topics.map(topicName).filter(Boolean).join(", ");
  return (
    <details className={`prow ${pc(i.topic_id)}`}>
      <summary>
        <TierPill tier={i.tier} />
        <div className="prow-main">
          <div className="ptitle">{i.title}</div>
          <div className="pwhy">{whyText(i)}</div>
          <div className="pmeta">
            {lab && <span className="lab">{lab}</span>}
            {sig.map((x) => <span key={x}>{x}</span>)}
            {also && <span>Also relevant to: {also}</span>}
          </div>
        </div>
        <span className="chev" aria-hidden="true">›</span>
      </summary>
      <div className="pbody">
        <div>
          <div className="label">What it&apos;s about</div>
          <p>{aboutText(i)}</p>
        </div>
        <div className="angle">
          <div className="label">Client angle</div>
          {i.audience && <p><b>Who it matters to:</b> {i.audience}</p>}
          {i.say && <p className="say-line">“{i.say}”</p>}
          {!i.audience && !i.say && <p className="muted">Not written this week.</p>}
        </div>
        <div className="pbody-foot">
          <EvidenceMeter level={i.evidence} />
          {i.discussed_in.length > 0 && (
            <span className="xsmall muted">
              Discussed in{" "}
              {i.discussed_in.map((b, k) => (
                <span key={b.url}>{k > 0 && ", "}<a href={b.url} target="_blank" rel="noreferrer">{b.title}</a></span>
              ))}
            </span>
          )}
        </div>
        <div className="pbody-actions">
          <MarkButtons paperId={i.paper_id} itemId={i.id} topicId={i.topic_id} marks={i.marks} />
          <a className="open-paper" href={i.url} target="_blank" rel="noreferrer">Open paper ↗</a>
          {i.code_url && <a className="open-paper" href={i.code_url} target="_blank" rel="noreferrer">Code ↗</a>}
        </div>
      </div>
    </details>
  );
}

/** Pastel stat tile. `tone` picks the pastel (0–7). */
export function Tile({ num, label, sub, tone = 0 }: { num: string | number; label: string; sub?: string; tone?: number }) {
  return (
    <div className={`tile pc-${tone}`}>
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
      <div className="row" style={{ marginTop: 12 }}>
        <form action={runDailyNow} className="inline">
          <button className="primary">Run daily now</button>
        </form>
        <form action={makeBriefNow} className="inline">
          <button>Make brief now</button>
        </form>
      </div>
      <p className="small muted" style={{ marginTop: 12 }}>
        Run daily now collects today&apos;s new papers (takes 3–10 min). Make brief now builds this week&apos;s brief and emails it
        (takes 2–5 min). Scheduled runs happen automatically every day at 6:00 AM IST and Monday 6:30 AM IST.
      </p>
      <div className="small" style={{ marginTop: 12, display: "grid", gap: 6 }}>
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
