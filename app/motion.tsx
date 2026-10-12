"use client";
// Motion layer (no library): reveal-on-scroll with stagger, count-up numbers, growing bars, click
// ripples, a scroll progress bar and a back-to-top button.
//
// The "motion" class is set by a tiny inline script in <head> before the first paint (see
// layout.tsx), so cards start hidden and fade in once — no flash of content on slow phones. That
// script removes the class again after 2.5 s if this component never mounts, so content can never
// stay hidden. Reduced-motion visitors never get the class at all.
import { useEffect, useState } from "react";

/** Must match the selector list in globals.css (Motion section). */
const REVEAL = [
  ".hero", ".tile", ".topic-card", ".topic-band", ".paper", ".card", ".bar-row", ".step", ".tool",
  ".also", ".more-link", ".view-bar", ".table-wrap", "tbody tr", ".chips > .chip", ".quiet",
].join(",");
const RIPPLE = "button, .btn, .chip, .side-link, .topic-card, .more-link";
const MAX_ROW_INDEX = 40; // only the first 40 rows of a table animate (CSS: nth-child(-n+40))

declare global {
  interface Window {
    __rpMotion?: boolean;
  }
}

function countUp(el: HTMLElement) {
  const text = el.textContent?.trim() ?? "";
  const m = text.match(/^(\$?)([\d,]+(?:\.\d+)?)$/);
  if (!m || el.dataset.counted) return;
  el.dataset.counted = "1";
  const target = Number(m[2].replace(/,/g, ""));
  const decimals = (m[2].split(".")[1] ?? "").length;
  const start = performance.now();
  const dur = 900;
  const fmt = (v: number) => m[1] + v.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  const tick = (t: number) => {
    const p = Math.min(1, (t - start) / dur);
    el.textContent = fmt(target * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(tick);
    else el.textContent = text;
  };
  requestAnimationFrame(tick);
}

export function Motion() {
  const [progress, setProgress] = useState(0);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    window.__rpMotion = true;
    const animate = root.classList.contains("motion");

    const pending = new Set<HTMLElement>(); // observed, not yet revealed
    const reveal = (el: HTMLElement) => {
      pending.delete(el);
      el.classList.add("rp-in");
      el.querySelectorAll<HTMLElement>(".tile-num").forEach(countUp);
    };

    const io = animate
      ? new IntersectionObserver(
          (entries) => {
            for (const e of entries) {
              if (!e.isIntersecting) continue;
              reveal(e.target as HTMLElement);
              io?.unobserve(e.target);
            }
          },
          { rootMargin: "0px 0px -6% 0px", threshold: 0 },
        )
      : null;

    const prepare = (scope: ParentNode) => {
      if (!io) return;
      const els = [...(scope instanceof HTMLElement && scope.matches(REVEAL) ? [scope] : []), ...scope.querySelectorAll<HTMLElement>(REVEAL)];
      for (const el of els) {
        if (el.dataset.reveal) continue;
        el.dataset.reveal = "1";
        const i = el.parentElement ? Array.prototype.indexOf.call(el.parentElement.children, el) : 0;
        if (el.matches("tbody tr") && i >= MAX_ROW_INDEX) continue; // CSS doesn't hide these
        el.style.setProperty("--d", `${Math.min(i, 8) * 55}ms`);
        // Content of a collapsed <details> never intersects; it is revealed on "toggle" instead.
        const box = el.closest("details");
        if (box && !box.open) continue;
        pending.add(el);
        io.observe(el);
      }
    };
    prepare(document);

    // Opening a <details> reveals what is inside it (toggle doesn't bubble, so listen in capture).
    const onToggle = (e: Event) => {
      const box = e.target as HTMLDetailsElement;
      if (!animate || !(box instanceof HTMLDetailsElement) || !box.open) return;
      requestAnimationFrame(() =>
        box.querySelectorAll<HTMLElement>("[data-reveal]:not(.rp-in)").forEach((el) => {
          io?.unobserve(el);
          reveal(el);
        }),
      );
    };
    document.addEventListener("toggle", onToggle, true);

    // New content (switching topics, refreshed lists) animates in too.
    const mo = animate
      ? new MutationObserver((muts) => {
          for (const m of muts) m.addedNodes.forEach((n) => n instanceof HTMLElement && prepare(n));
        })
      : null;
    mo?.observe(document.body, { childList: true, subtree: true });

    // Click ripple
    const onDown = (e: PointerEvent) => {
      if (!animate) return;
      const el = (e.target as HTMLElement).closest<HTMLElement>(RIPPLE);
      if (!el || (el as HTMLButtonElement).disabled) return;
      const r = el.getBoundingClientRect();
      const size = Math.max(r.width, r.height) * 1.6;
      const s = document.createElement("span");
      s.className = "ripple";
      s.style.width = s.style.height = `${size}px`;
      s.style.left = `${e.clientX - r.left - size / 2}px`;
      s.style.top = `${e.clientY - r.top - size / 2}px`;
      el.appendChild(s);
      setTimeout(() => s.remove(), 650);
    };
    document.addEventListener("pointerdown", onDown);

    // Safety net while scrolling (at most every 150 ms): anything at or above the bottom of the screen
    // is shown, even if a fast fling or the End key skipped past it, or it sits in the last strip of
    // the page.
    let settle: ReturnType<typeof setTimeout> | undefined;
    const sweep = () => {
      for (const el of pending) {
        if (!el.isConnected) pending.delete(el);
        else if (el.getBoundingClientRect().top < window.innerHeight) {
          io?.unobserve(el);
          reveal(el);
        }
      }
    };

    // Scroll progress + back-to-top
    const onScroll = () => {
      const max = root.scrollHeight - window.innerHeight;
      setProgress(max > 0 ? window.scrollY / max : 0);
      setShowTop(window.scrollY > 700);
      if (animate && !settle) {
        settle = setTimeout(() => {
          settle = undefined;
          sweep();
        }, 150);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => {
      clearTimeout(settle);
      io?.disconnect();
      mo?.disconnect();
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("toggle", onToggle, true);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <>
      <div className="scroll-progress" style={{ transform: `scaleX(${progress})` }} aria-hidden="true" />
      <button
        type="button"
        className={`to-top ${showTop ? "show" : ""}`}
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        aria-label="Back to top"
        tabIndex={showTop ? 0 : -1}
      >
        ↑ top
      </button>
    </>
  );
}
