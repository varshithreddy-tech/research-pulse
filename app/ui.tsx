// Small shared pieces of the dashboard.
import { toggleMark, runDailyNow, makeBriefNow } from "./actions";
import { AutoRefresh } from "./refresh";

const MARKS: { kind: "read_fully" | "share" | "not_useful"; label: string }[] = [
  { kind: "read_fully", label: "Read fully" },
  { kind: "share", label: "Share with a client" },
  { kind: "not_useful", label: "Not useful" },
];

export function MarkButtons(props: { paperId: number; itemId: number | null; topicId: number | null; marks: string[] }) {
  return (
    <div className="row" style={{ marginTop: 6 }}>
      {MARKS.map((m) => {
        const on = props.marks.includes(m.kind);
        return (
          <form key={m.kind} action={toggleMark.bind(null, props.paperId, m.kind, props.itemId, props.topicId)} className="inline">
            <button className={on ? "on" : ""} title={on ? "Click to undo" : undefined}>
              {on ? "✓ " : ""}
              {m.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}

export function AdminButtons() {
  return (
    <div className="row">
      <form action={runDailyNow} className="inline">
        <button>Run daily now</button>
      </form>
      <form action={makeBriefNow} className="inline">
        <button>Make brief now</button>
      </form>
    </div>
  );
}

export function Notice({ msg }: { msg?: string }) {
  return msg ? <div className="notice">{msg}</div> : null;
}

export function Relevance({ status, relevant }: { status: string; relevant: boolean | null }) {
  if (status === "pending") return <span className="tag warn">Waiting for check</span>;
  if (status === "not_assessed") return <span className="tag bad">Not assessed</span>;
  return relevant ? <span className="tag ok">On-topic</span> : <span className="tag">Not on-topic</span>;
}

export function PubStatus({ s, venue }: { s: string; venue?: string | null }) {
  return <span className="tag">{s === "peer_reviewed" ? `Peer-reviewed${venue ? ` · ${venue}` : ""}` : "Preprint"}</span>;
}

export function RunStatus({ status, heartbeat }: { status: string; heartbeat?: string }) {
  const stale = status === "running" && heartbeat && Date.now() - new Date(heartbeat).getTime() > 15 * 60_000;
  const cls = status === "done" ? "ok" : status === "running" && !stale ? "warn" : status === "partial" ? "warn" : "bad";
  return (
    <>
      <span className={`tag ${cls}`}>{stale ? "stalled" : status}</span>
      {status === "running" && !stale && <AutoRefresh seconds={15} />}
    </>
  );
}

export const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString("en-IN");
export const usd = (n: number | string | null | undefined) => `$${Number(n ?? 0).toFixed(4)}`;
