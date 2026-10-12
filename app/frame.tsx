"use client";
// App frame: left sidebar (pages + this week's topics), mobile drawer, main area.
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { pc } from "./palette";

export interface SideTopic {
  id: number;
  name: string;
  count: number; // on-topic papers in the latest brief
}

const PAGES = [
  { href: "/", label: "This week", icon: Icon.brief },
  { href: "/papers", label: "All papers", icon: Icon.papers },
  { href: "/topics", label: "Topics", icon: Icon.topics },
  { href: "/shortlist", label: "Client shortlist", icon: Icon.shortlist },
  { href: "/coverage", label: "Cost & coverage", icon: Icon.coverage },
  { href: "/how", label: "How it works", icon: Icon.how },
];

export function Frame(props: { topics: SideTopic[]; week: string | null; shortlist: number; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");

  useEffect(() => {
    const read = () => setHash(window.location.hash);
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  useEffect(() => setOpen(false), [path, hash]);

  return (
    <div className={`app ${open ? "open" : ""}`}>
      <aside className="sidebar" aria-label="Navigation">
        <button className="ghost drawer-close" onClick={() => setOpen(false)} aria-label="Close menu"><Icon.close /></button>
        <a href="/" className="logo">
          <span className="logo-mark"><Icon.pulse /></span>
          <span>
            <span className="logo-name">Research Pulse</span>
            <br />
            <span className="logo-tag">Kavita&apos;s weekly AI research brief</span>
          </span>
        </a>

        <nav>
          <div className="side-label">Menu</div>
          <div className="side-nav">
            {PAGES.map((p) => {
              const active = path === p.href && !(p.href === "/" && hash.startsWith("#t-"));
              const I = p.icon;
              return (
                <a key={p.href} href={p.href} className={`side-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                  <I />
                  {p.label}
                  {p.href === "/shortlist" && props.shortlist > 0 && <span className="count">{props.shortlist}</span>}
                </a>
              );
            })}
          </div>
        </nav>

        {props.topics.length > 0 && (
          <nav aria-label="This week's topics">
            <div className="side-label">This week&apos;s topics</div>
            <div className="side-nav">
              {props.topics.map((t) => {
                const active = path === "/" && hash === `#t-${t.id}`;
                return (
                  <a key={t.id} href={`/#t-${t.id}`} className={`side-link side-topic ${pc(t.id)} ${active ? "active" : ""}`} title={t.name}>
                    <span className="dot" />
                    <span className="name">{t.name}</span>
                    <span className="count">{t.count}</span>
                  </a>
                );
              })}
            </div>
          </nav>
        )}

        <div className="side-foot">
          {props.week ? <>Brief for <b style={{ color: "var(--text)" }}>{props.week}</b></> : "No brief yet"}
          <div className="faint" style={{ marginTop: 2 }}>New brief every Monday 6:30 AM IST</div>
        </div>
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />

      <div className="main">
        <div className="mobile-bar">
          <button className="ghost" onClick={() => setOpen(true)} aria-label="Open menu"><Icon.menu /></button>
          <a href="/" className="logo" style={{ padding: 0 }}>
            <span className="logo-mark" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon.pulse /></span>
            <span className="logo-name">Research Pulse</span>
          </a>
        </div>
        {props.children}
      </div>
    </div>
  );
}
