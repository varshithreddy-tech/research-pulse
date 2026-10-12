// How it works — a plain-English tour for first-time visitors (and graders).
import { Shell } from "../shell";

export const metadata = { title: "How it works · Research Pulse" };

const STEPS: { title: string; body: string }[] = [
  {
    title: "Every day: collect new papers",
    body:
      "At 6:00 AM IST the system pulls every new paper from arXiv in each topic's research categories — the complete list, not a keyword search — and asks Tavily for papers on research sites (OpenReview, ACL, CVF, IEEE, ACM) and for blog posts about each topic.",
  },
  {
    title: "Clean up and check the evidence",
    body:
      "Repeats are merged (the same paper on arXiv and OpenReview becomes one record). Each paper gets a one-line summary and a Preprint / Peer-reviewed label from plain facts. Blogs are leads, not evidence: a blog only counts if a real, confirmed paper stands behind it — that paper becomes the item and the blog is shown as “Discussed in”.",
  },
  {
    title: "Relevance check",
    body:
      "Gemini Flash reads each paper against the plain-English focus of every topic it could belong to and answers yes or no with a one-line reason. Nothing is dropped: papers judged not relevant stay visible on All papers with their reason.",
  },
  {
    title: "Monday: rank the week",
    body:
      "At 6:30 AM IST the week's relevant papers get reaction numbers (citations from Semantic Scholar, upvotes and code from Hugging Face, blogs discussing them). Gemini asks “why might this matter?” — new test, surprising result or new way to see a problem — and ranks each topic. Its 0–10 score is internal: it only orders papers and is never shown.",
  },
  {
    title: "Write and email the brief",
    body:
      "Answer first: the week in 30 seconds, then the (at most) 3 papers to bring to a client. About 18 papers are picked across all topics, each once, in three tiers set by code — Bring to a client (max 3), Read this week (about 8), Just so you know. Each has a lab, a one-line why it matters and a client angle (who it matters to, how strong the evidence is, a sentence for a meeting). Every other paper stays one click away as “+ N more”. The brief goes to Kavita by email and appears here. Nothing is ever sent to a client.",
  },
  {
    title: "Kavita decides",
    body:
      "She reads in under 10 minutes and marks papers Read fully, Share with a client or Not useful — from the email in one click, or here. Shared papers go to her Client shortlist, where she tags them by client and exports a one-pager; “You missed this” catches anything that slipped through. Her marks are fed back to Gemini the next Monday.",
  },
];

const TOOLS: { name: string; role: string }[] = [
  { name: "arXiv", role: "The complete list of new research papers, fetched by category every day." },
  { name: "Tavily", role: "Web search for papers on research sites and blog posts about each topic." },
  { name: "Semantic Scholar", role: "Confirms papers exist; citations, venue and authors' past work." },
  { name: "Hugging Face", role: "Community upvotes and links to shared code." },
  { name: "Gemini Flash", role: "All the reading, judging, ranking and writing — it suggests, it never decides." },
  { name: "Neon", role: "The database: every paper, blog, run, brief and mark." },
  { name: "Resend", role: "Sends the Monday email — only to Kavita." },
  { name: "Vercel", role: "Hosts this website and runs the two scheduled jobs." },
];

export default function HowPage() {
  return (
    <Shell>
      <main className="container">
        <div className="page-head hero">
          <div className="eyebrow">For first-time visitors</div>
          <h1>How it works</h1>
          <p className="sub">
            Kavita advises clients on AI strategy and needs to know what&apos;s actually being published in her topics. Research Pulse reads the
            week&apos;s research for her and puts the papers worth her time first — in a brief she can read in under 10 minutes.
          </p>
        </div>

        <p className="rule">The system decides what Kavita sees first — never what she never sees.</p>

        <section className="section">
          <h2 style={{ marginBottom: 12 }}>Six steps</h2>
          <div className="steps">
            {STEPS.map((s, i) => (
              <div key={s.title} className={`card step pc-${i}`}>
                <div className="step-num">{i + 1}</div>
                <div>
                  <h3>{s.title}</h3>
                  <p className="small muted" style={{ marginTop: 6 }}>{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <h2 style={{ marginBottom: 12 }}>Rules built in</h2>
          <div className="card small">
            <ul style={{ margin: 0, paddingLeft: 20, display: "grid", gap: 6 }}>
              <li><b>Rank, never hide.</b> Every paper checked is listed on All papers — including those not relevant, not assessed or older.</li>
              <li><b>Facts, not labels.</b> Citations, upvotes, code and Preprint / Peer-reviewed are shown as facts; no paper is called “validated”.</li>
              <li><b>Blogs are leads, papers are evidence.</b> A blog never counts on its own.</li>
              <li><b>Nothing reaches a client without Kavita.</b> The system only ever emails her.</li>
            </ul>
          </div>
        </section>

        <section className="section">
          <h2 style={{ marginBottom: 12 }}>Tools used</h2>
          <div className="tools">
            {TOOLS.map((t, i) => (
              <div key={t.name} className={`card tool pc-${i}`}>
                <div className="tool-icon">{t.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
                <div>
                  <h3>{t.name}</h3>
                  <p className="small muted" style={{ marginTop: 4 }}>{t.role}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Components map</h2>
            <a href="/components-map.png" target="_blank" rel="noreferrer" className="small">Open full size ↗</a>
          </div>
          <a href="/components-map.png" target="_blank" rel="noreferrer" className="map-frame" aria-label="Open the components map full size">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/components-map.png" alt="Research Pulse components map: daily collection, Gemini checks, Monday ranking, brief and email, Kavita's decisions" loading="lazy" />
          </a>
        </section>

        <section className="section">
          <div className="card spread">
            <div>
              <h3>See the Monday email</h3>
              <p className="small muted" style={{ marginTop: 4 }}>A preview of this week&apos;s email, rendered here — nothing is sent.</p>
            </div>
            <a href="/email-preview" className="btn">Open email preview</a>
          </div>
        </section>
      </main>
    </Shell>
  );
}
