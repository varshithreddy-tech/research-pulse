"use client";
// App frame: left sidebar (pages · this week's topics · settings), light/dark toggle, mobile drawer, main area.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Icon } from "./icons";
import { pc } from "./palette";
import { Motion } from "./motion";

export interface SideTopic {
  id: number;
  name: string;
  count: number; // papers picked under this topic in the latest brief
}

const PAGES = [
  { href: "/", label: "This week", icon: Icon.brief },
  { href: "/shortlist", label: "Client shortlist", icon: Icon.shortlist },
  { href: "/papers", label: "All papers", icon: Icon.papers },
];
const SETTINGS = [
  { href: "/topics", label: "Edit topics", icon: Icon.topics },
  { href: "/coverage", label: "Cost & coverage", icon: Icon.coverage },
  { href: "/how", label: "How it works", icon: Icon.how },
];

/** Light / dark. Follows the device until chosen; the choice is remembered on this device. */
function ThemeToggle({ className = "" }: { className?: string }) {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    const t = document.documentElement.dataset.theme;
    setDark(t ? t === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches);
  }, []);
  const flip = () => {
    const next = !dark;
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("rp-theme", next ? "dark" : "light");
    } catch {}
    setDark(next);
  };
  return (
    <button type="button" className={`theme-toggle ${className}`} onClick={flip} aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}>
      <span aria-hidden="true">{dark ? "☀" : "☾"}</span> {dark === null ? "Theme" : dark ? "Light" : "Dark"}
    </button>
  );
}

/**
 * Sliding highlight behind the active link of one sidebar group. It remembers where it was (this tab
 * only), so after a page load it glides from the previous page's link to the new one. Until it is
 * placed, the link's own .active style shows — so without JS nothing changes.
 */
function useSlidingPill(key: string, deps: unknown[]) {
  const nav = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const box = nav.current;
    const p = pill.current;
    if (!box || !p) return;
    const active = box.querySelector<HTMLElement>(".side-link.active");
    if (!active || !active.offsetHeight) {
      box.classList.remove("has-pill");
      return;
    }
    let prev: { top: number; height: number; bg: string } | null = null;
    try {
      prev = JSON.parse(sessionStorage.getItem(`rp-pill-${key}`) ?? "null");
    } catch {}
    const next = {
      top: active.offsetTop,
      height: active.offsetHeight,
      bg: active.classList.contains("side-topic") ? getComputedStyle(active).getPropertyValue("--pc-bg").trim() : "",
    };
    const place = (v: { top: number; height: number; bg: string }) => {
      p.style.transform = `translateY(${v.top}px)`;
      p.style.height = `${v.height}px`;
      p.style.background = v.bg;
    };
    if (!box.classList.contains("has-pill") && prev) {
      // First placement on this page: start where the last page left it, then glide.
      p.classList.add("no-slide");
      place(prev);
      box.classList.add("has-pill");
      void p.offsetWidth;
      p.classList.remove("no-slide");
    }
    box.classList.add("has-pill");
    place(next);
    try {
      sessionStorage.setItem(`rp-pill-${key}`, JSON.stringify(next));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { nav, pill };
}

export function Frame(props: { topics: SideTopic[]; week: string | null; nextBrief: string; shortlist: number; papers: number | null; children: React.ReactNode }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [hash, setHash] = useState("");
  const menu = useSlidingPill("menu", [path, hash, open]);
  const topicsPill = useSlidingPill("topics", [path, hash, open]);
  const settingsPill = useSlidingPill("settings", [path, hash, open]);

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
          <div className="side-nav" ref={menu.nav}>
            <span className="side-pill" ref={menu.pill} aria-hidden="true" />
            {PAGES.map((p) => {
              const active = path === p.href && !(p.href === "/" && hash.startsWith("#t-"));
              const I = p.icon;
              return (
                <a key={p.href} href={p.href} className={`side-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                  <I />
                  {p.label}
                  {p.href === "/shortlist" && props.shortlist > 0 && <span className="count">{props.shortlist}</span>}
                  {p.href === "/papers" && props.papers ? <span className="count" title="Scanned this week">{props.papers.toLocaleString("en-IN")}</span> : null}
                </a>
              );
            })}
          </div>
        </nav>

        {props.topics.length > 0 && (
          <nav aria-label="This week's topics">
            <div className="side-label">This week&apos;s topics</div>
            <div className="side-nav" ref={topicsPill.nav}>
              <span className="side-pill" ref={topicsPill.pill} aria-hidden="true" />
              {props.topics.map((t) => {
                const active = path === "/" && hash === `#t-${t.id}`;
                return (
                  <a key={t.id} href={`/#t-${t.id}`} className={`side-link side-topic ${pc(t.id)} ${active ? "active" : ""}`} title={t.name}>
                    <span className="dot" />
                    <span className="name">{t.name}</span>
                    <span className="count" title="Picked this week">{t.count}</span>
                  </a>
                );
              })}
            </div>
          </nav>
        )}

        <nav aria-label="Settings">
          <div className="side-label">Settings</div>
          <div className="side-nav" ref={settingsPill.nav}>
            <span className="side-pill" ref={settingsPill.pill} aria-hidden="true" />
            {SETTINGS.map((p) => {
              const active = path === p.href;
              const I = p.icon;
              return (
                <a key={p.href} href={p.href} className={`side-link ${active ? "active" : ""}`} aria-current={active ? "page" : undefined}>
                  <I />
                  {p.label}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="side-foot">
          {props.week ? <>Brief for <b style={{ color: "var(--text)" }}>{props.week}</b></> : "No brief yet"}
          <div className="faint" style={{ marginTop: 2 }}>Next brief <b>{props.nextBrief}</b> IST · topic changes apply from the next run.</div>
          <ThemeToggle />
        </div>
      </aside>
      <div className="backdrop" onClick={() => setOpen(false)} />

      <Motion />
      <div className="main">
        <div className="mobile-bar">
          <button className="ghost" onClick={() => setOpen(true)} aria-label="Open menu"><Icon.menu /></button>
          <a href="/" className="logo" style={{ padding: 0 }}>
            <span className="logo-mark" style={{ width: 28, height: 28, borderRadius: 8 }}><Icon.pulse /></span>
            <span className="logo-name">Research Pulse</span>
          </a>
          <ThemeToggle className="mobile-theme" />
        </div>
        {props.children}
      </div>
    </div>
  );
}
