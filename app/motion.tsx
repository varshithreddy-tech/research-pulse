"use client";
// Motion layer (no library): reveal-on-scroll with stagger, count-up numbers, growing bars, click
// ripples, a scroll progress bar and a back-to-top button. On the landing page: the header plays in
// order (headline → heartbeat line → numbers → funnel), and topic cards get a cursor spotlight + tilt.
//
// The "motion" class is set by a tiny inline script in <head> before the first paint (see
// layout.tsx), so cards start hidden and fade in once — no flash of content on slow phones. That
// script removes the class again after 2.5 s if this component never mounts, so content can never
// stay hidden. Reduced-motion visitors never get the class at all.
//
// Once per visit: the second time "This week" is opened in the same tab, the head script sets
// "intro-seen" instead of "motion"; here, what is already on screen is shown at once and only content
// further down animates on scroll.
import { useEffect, useState } from "react";

/** Must match the selector list in globals.css (Motion section). */
const REVEAL = [
  ".hero", ".tile", ".topic-card", ".topic-band", ".paper", ".card", ".bar-row", ".step", ".tool",
  ".also", ".more-link", ".view-bar", ".table-wrap", "tbody tr", ".chips > .chip", ".quiet", ".f-row",
].join(",");
const RIPPLE = "button, .btn, .chip, .side-link, .topic-card, .more-link";
const MAX_ROW_INDEX = 40; // only the first 40 rows of a table animate (CSS: nth-child(-n+40))

declare global {
  interface Window {
    __rpMotion?: boolean;
  }
}

function countUp(el: HTMLElement, delay = 0) {
  if (delay > 0) {
    setTimeout(() => countUp(el), delay);
    return;
  }
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
    const seen = root.classList.contains("intro-seen") && !root.classList.contains("motion");
    const animate = root.classList.contains("motion") || seen;

    const pending = new Set<HTMLElement>(); // observed, not yet revealed
    const reveal = (el: HTMLElement, instant = false) => {
      pending.delete(el);
      el.classList.add("rp-in");
      if (instant) return;
      const delay = parseFloat(el.style.getPropertyValue("--d")) || 0;
      el.querySelectorAll<HTMLElement>(".tile-num, .count-up").forEach((n) => countUp(n, delay));
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
        // In the landing header, the numbers wait for the headline and the funnel for the numbers.
        const inHero = !el.matches(".hero") && !!el.closest(".hero");
        const d = el.matches(".f-row") ? 750 + i * 260 : (inHero ? 320 : 0) + Math.min(i, 8) * 55;
        el.style.setProperty("--d", `${d}ms`);
        // Content of a collapsed <details> never intersects; it is revealed on "toggle" instead.
        const box = el.closest("details");
        if (box && !box.open) continue;
        pending.add(el);
        io.observe(el);
      }
    };
    prepare(document);

    if (seen) {
      // Second visit: show what is on screen now without animating, then switch motion on for the rest.
      root.classList.add("instant");
      for (const el of [...pending]) {
        if (el.getBoundingClientRect().top < window.innerHeight) {
          io?.unobserve(el);
          reveal(el, true);
        }
      }
      root.classList.add("motion");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("instant")));
    }

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

    // Topic cards: a soft spotlight follows the cursor and the card tilts slightly (mouse/trackpad only).
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    let tiltCard: HTMLElement | null = null;
    let lastMove: PointerEvent | null = null;
    let tiltFrame = 0;
    const onMove = (e: PointerEvent) => {
      if (!animate || !fine) return;
      lastMove = e;
      if (tiltFrame) return;
      tiltFrame = requestAnimationFrame(() => {
        tiltFrame = 0;
        const ev = lastMove!;
        const card = ev.target instanceof Element ? ev.target.closest<HTMLElement>(".topic-card") : null;
        if (tiltCard && tiltCard !== card) {
          tiltCard.style.removeProperty("--rx");
          tiltCard.style.removeProperty("--ry");
        }
        tiltCard = card;
        if (!card) return;
        const r = card.getBoundingClientRect();
        const x = (ev.clientX - r.left) / r.width;
        const y = (ev.clientY - r.top) / r.height;
        card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
        card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
        card.style.setProperty("--ry", `${((x - 0.5) * 6).toFixed(2)}deg`);
        card.style.setProperty("--rx", `${((0.5 - y) * 5).toFixed(2)}deg`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });

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
      document.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(tiltFrame);
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
