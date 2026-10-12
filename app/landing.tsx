// Landing-page pieces for "This week": the headline that rises in word by word, the heartbeat line
// under it, and the funnel of real counts (checked → on-topic → shown in full). The motion itself is
// CSS (globals.css, "Landing") plus app/motion.tsx; without motion everything shows as is.
import { fmt } from "./ui";

export function Headline({ text }: { text: string }) {
  const words = text.split(" ");
  return (
    <h1 className="words" aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden="true">
          <span className="w" style={{ "--i": i } as React.CSSProperties}><span>{w}</span></span>
          {i < words.length - 1 ? " " : null}
        </span>
      ))}
    </h1>
  );
}

// Two beats on a flat line, drawn in a 1000 × 40 box that stretches to the hero's width.
const BEAT = (x: number) =>
  `L${x} 20 C${x + 4} 20 ${x + 6} 14 ${x + 10} 14 S${x + 16} 20 ${x + 20} 20 L${x + 25} 25 L${x + 33} 3 L${x + 41} 37 L${x + 47} 20 ` +
  `L${x + 58} 20 C${x + 64} 20 ${x + 68} 12 ${x + 75} 12 S${x + 86} 20 ${x + 92} 20`;
const PATH = `M0 20 ${BEAT(250)} ${BEAT(690)} L1000 20`;

export function PulseLine() {
  return (
    <div className="pulse-line" aria-hidden="true">
      <svg viewBox="0 0 1000 40" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pulse-grad" x1="0" x2="1" y1="0" y2="0">
            <stop offset="0" stopColor="var(--p0-dot)" />
            <stop offset="0.5" stopColor="var(--p5-dot)" />
            <stop offset="1" stopColor="var(--p3-dot)" />
          </linearGradient>
        </defs>
        <path className="pl-base" d={PATH} pathLength={1} />
        <path className="pl-glow" d={PATH} pathLength={1} />
      </svg>
    </div>
  );
}

/** Bar widths are to scale (smallest bar kept just wide enough to see). */
export function Funnel({ checked, onTopic, inBrief, href }: { checked: number; onTopic: number; inBrief: number; href: string }) {
  if (!checked) return null;
  const w = (n: number) => `${Math.max(3, Math.min(100, (n / checked) * 100))}%`;
  const rows = [
    { n: checked, label: "papers scanned", tone: 0 },
    { n: onTopic, label: "judged on-topic for at least one topic", tone: 1 },
    { n: inBrief, label: "picked for the brief", tone: 2 },
  ];
  return (
    <div className="funnel" aria-label="How this week's papers were narrowed down">
      {rows.map((r, i) => (
        <div key={i} className={`f-row pc-${r.tone}`} style={{ "--fi": i } as React.CSSProperties}>
          <div className="f-text">
            <span className="f-num count-up">{fmt(r.n)}</span> {r.label}
          </div>
          <div className="f-track">
            <span className="f-bar" style={{ width: w(r.n) }} />
          </div>
        </div>
      ))}
      <a className="f-note" href={href}>Nothing is hidden — every paper checked is listed, ranked →</a>
    </div>
  );
}
