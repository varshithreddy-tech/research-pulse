"use client";
// Read fully / Share with a client / Not useful — the ✓ appears instantly, then the server confirms.
import { useOptimistic, useState, useTransition } from "react";
import { toggleMark } from "./actions";

type Kind = "read_fully" | "share" | "not_useful";

const FULL: [Kind, string][] = [
  ["read_fully", "Read fully"],
  ["share", "Share with a client"],
  ["not_useful", "Not useful"],
];
const SHORT: [Kind, string][] = [
  ["read_fully", "Read"],
  ["share", "Share"],
  ["not_useful", "Not useful"],
];

export function MarkButtons(props: { paperId: number; itemId: number | null; topicId: number | null; marks: string[]; compact?: boolean }) {
  const [marks, setMarks] = useOptimistic(props.marks, (cur: string[], k: string) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  const [pending, start] = useTransition();
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);

  const click = (k: Kind, label: string) =>
    start(async () => {
      const turningOn = !marks.includes(k);
      setMarks(k);
      await toggleMark(props.paperId, k, props.itemId, props.topicId);
      setToast({ text: turningOn ? `Saved: ${label}` : `Removed: ${label}`, n: Date.now() });
    });

  return (
    <div className="actions" style={props.compact ? { marginTop: 0, gap: 4 } : undefined}>
      {(props.compact ? SHORT : FULL).map(([k, label]) => {
        const on = marks.includes(k);
        return (
          <button
            key={k}
            type="button"
            className={`${on ? "on" : ""} ${k}`}
            style={props.compact ? { padding: "5px 10px", fontSize: 12.5 } : undefined}
            aria-pressed={on}
            title={on ? "Saved — click to undo" : undefined}
            onClick={() => click(k, FULL.find(([x]) => x === k)![1])}
            disabled={pending}
          >
            {on ? "✓ " : ""}
            {label}
          </button>
        );
      })}
      {toast && !props.compact && (
        <span key={toast.n} className="toast" role="status">{toast.text}</span>
      )}
    </div>
  );
}
