import { logout } from "./actions";

export function Nav() {
  return (
    <nav className="top">
      <div className="inner">
        <a className="brand" href="/">Research Pulse</a>
        <a href="/">This week&apos;s brief</a>
        <a href="/papers">All papers</a>
        <a href="/topics">Topics</a>
        <a href="/shortlist">Client shortlist</a>
        <a href="/coverage">Cost &amp; coverage</a>
        <form action={logout} className="inline" style={{ marginLeft: "auto" }}>
          <button style={{ background: "transparent", color: "#a8a29e", border: "none" }}>Log out</button>
        </form>
      </div>
    </nav>
  );
}
