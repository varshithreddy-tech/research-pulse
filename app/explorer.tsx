"use client";
// Topic explorer on the brief page: overview grid → one topic at a time (from the grid or the left
// sidebar), or every topic stacked. Driven by the URL hash (#t-3, #all) so links and Back work.
import { useEffect, useState } from "react";
import { Icon } from "./icons";

export function TopicExplorer(props: {
  topics: { id: number; name: string }[];
  overview: React.ReactNode;
  panels: Record<string, React.ReactNode>;
}) {
  const [view, setView] = useState<string>("overview");

  useEffect(() => {
    const read = () => {
      const h = window.location.hash;
      if (h === "#all") setView("all");
      else if (h.startsWith("#t-") && props.panels[h.slice(3)]) setView(h.slice(3));
      else setView("overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [props.panels]);

  useEffect(() => {
    if (view !== "overview") document.getElementById("explorer")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [view]);

  const idx = props.topics.findIndex((t) => String(t.id) === view);
  const prev = idx > 0 ? props.topics[idx - 1] : null;
  const next = idx >= 0 && idx < props.topics.length - 1 ? props.topics[idx + 1] : null;

  return (
    <div id="explorer" style={{ scrollMarginTop: 20 }}>
      <div className="view-bar" role="tablist" aria-label="View">
        <a href="#" role="tab" aria-selected={view === "overview"} className={`chip ${view === "overview" ? "on" : ""}`} onClick={(e) => {
            e.preventDefault();
            history.pushState(null, "", window.location.pathname + window.location.search);
            window.dispatchEvent(new HashChangeEvent("hashchange")); // keeps the sidebar highlight in sync
          }}>
          <Icon.grid /> Overview
        </a>
        <a href="#all" role="tab" aria-selected={view === "all"} className={`chip ${view === "all" ? "on" : ""}`}>
          <Icon.list /> Show all topics
        </a>
        {idx >= 0 && <span className="xsmall faint">Topic {idx + 1} of {props.topics.length} · pick another from the left</span>}
      </div>

      <div key={view} className="view-enter">
      {view === "overview" && props.overview}
      {view === "all" && props.topics.map((t) => <div key={t.id} className="topic-block">{props.panels[String(t.id)]}</div>)}
      {idx >= 0 && (
        <>
          {props.panels[view]}
          <div className="pager">
            {prev ? <a className="btn" href={`#t-${prev.id}`}><Icon.arrowL /> {prev.name}</a> : <span />}
            {next ? <a className="btn" href={`#t-${next.id}`}>{next.name} <Icon.arrowR /></a> : <a className="btn" href="#all">Show all topics</a>}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
