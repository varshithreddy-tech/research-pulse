"use client";
// Instant search over the rows already on the page (title, summary, topic, reason).
import { useState } from "react";
import { Icon } from "./icons";

export function InstantSearch({ target, placeholder }: { target: string; placeholder: string }) {
  const [shown, setShown] = useState<number | null>(null);
  const onChange = (value: string) => {
    const qv = value.trim().toLowerCase();
    const rows = document.querySelectorAll<HTMLElement>(`#${target} [data-search]`);
    let n = 0;
    rows.forEach((r) => {
      const hit = !qv || (r.dataset.search ?? "").includes(qv);
      r.style.display = hit ? "" : "none";
      if (hit) n++;
    });
    setShown(qv ? n : null);
  };
  return (
    <div className="search" style={{ flex: "1 1 280px" }}>
      <Icon.search />
      <input type="search" placeholder={placeholder} aria-label={placeholder} onChange={(e) => onChange(e.target.value)} />
      {shown !== null && <div className="xsmall muted" style={{ marginTop: 6, paddingLeft: 14 }}>{shown} matching on this page</div>}
    </div>
  );
}
