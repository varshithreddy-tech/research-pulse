"use client";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "This week" },
  { href: "/papers", label: "All papers" },
  { href: "/topics", label: "Topics" },
  { href: "/shortlist", label: "Client shortlist" },
  { href: "/coverage", label: "Cost & coverage" },
  { href: "/how", label: "How it works" },
];

export function Nav() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <div className="brand">
          <a href="/">Research Pulse</a>
          <span className="tagline">Kavita&apos;s weekly AI research brief</span>
        </div>
        <nav className="nav" aria-label="Main">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className={path === l.href ? "active" : undefined} aria-current={path === l.href ? "page" : undefined}>
              {l.label}
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}
