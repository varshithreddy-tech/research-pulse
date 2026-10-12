// The brief as data (shared by the email and the dashboard) and its email rendering.
// Facts and counts come straight from Neon; Gemini's words are only the reasons and "What's changing".
import { q, q1 } from "./db";
import { appUrl } from "./env";
import { weekLabel } from "./time";
import { MARK_KINDS, MARK_LABEL, makeMarkToken } from "./markToken";

export const TYPE_LABEL: Record<string, string> = {
  new_test: "New test",
  surprising_result: "Surprising result",
  new_way_to_see_problem: "New way to see the problem",
  nothing_new: "Nothing new",
};

export const FOOTER = "This brief suggests. You decide what to read and what to share.";

/**
 * An "older paper": reached us through a blog, a research-site search or "You missed this" (not the
 * arXiv category fetch) and was published before the window starts. Kept and shown, labelled
 * "Older paper (YEAR) — discussed this week", never counted as new, ranked below new papers.
 * `p` is the papers alias; `start` the SQL expression for the window start.
 */
export function olderSql(p: string, start: string): string {
  return `(${p}.found_via <> 'arxiv' AND ${p}.published_at IS NOT NULL AND ${p}.published_at < ${start})`;
}

export function olderLabel(year: number | null): string {
  return `Older paper${year ? ` (${year})` : ""} — discussed this week`;
}

export interface TopicCounts {
  topic_id: number;
  name: string;
  checked: number;
  relevant: number;
  not_relevant: number;
  not_assessed: number;
  pending: number;
  older: number; // older papers discussed this week (not in "checked")
}

export interface WindowCounts {
  papers_checked: number; // NEW papers only
  older_discussed: number;
  topics: TopicCounts[];
  blogs_checked: number;
  blogs_with_paper: number;
  blogs_no_paper: number;
  blogs_unchecked: number;
  unconfirmed: number;
}

/** What the system checked between `ws` and `we` (by when papers were first found). */
export async function windowCounts(ws: Date | string, we: Date | string): Promise<WindowCounts> {
  const topics = await q<TopicCounts>(
    `SELECT t.id AS topic_id, t.name,
       count(pt.paper_id) FILTER (WHERE NOT pt.older)::int AS checked,
       count(*) FILTER (WHERE NOT pt.older AND pt.status = 'assessed' AND pt.relevant)::int AS relevant,
       count(*) FILTER (WHERE NOT pt.older AND pt.status = 'assessed' AND NOT pt.relevant)::int AS not_relevant,
       count(*) FILTER (WHERE NOT pt.older AND pt.status = 'not_assessed')::int AS not_assessed,
       count(*) FILTER (WHERE NOT pt.older AND pt.status = 'pending')::int AS pending,
       count(pt.paper_id) FILTER (WHERE pt.older)::int AS older
     FROM topics t
     LEFT JOIN (
       SELECT x.*, ${olderSql("p", "$1")} AS older FROM paper_topics x JOIN papers p ON p.id = x.paper_id
       WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed'
     ) pt ON pt.topic_id = t.id
     WHERE t.active GROUP BY t.id ORDER BY t.sort_order, t.id`,
    [ws, we],
  );
  const totals = await q1<Omit<WindowCounts, "topics">>(
    `SELECT
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
          JOIN topics t ON t.id = pt.topic_id AND t.active
        WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed' AND NOT ${olderSql("p", "$1")})::int AS papers_checked,
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
          JOIN topics t ON t.id = pt.topic_id AND t.active
        WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed' AND ${olderSql("p", "$1")})::int AS older_discussed,
       (SELECT count(*) FROM blogs WHERE found_at >= $1 AND found_at < $2)::int AS blogs_checked,
       (SELECT count(*) FROM blogs WHERE found_at >= $1 AND found_at < $2 AND evidence_status = 'paper_confirmed')::int AS blogs_with_paper,
       (SELECT count(*) FROM blogs WHERE found_at >= $1 AND found_at < $2 AND evidence_status IN ('no_paper', 'link_not_confirmed'))::int AS blogs_no_paper,
       (SELECT count(*) FROM blogs WHERE found_at >= $1 AND found_at < $2 AND evidence_status IN ('pending', 'not_assessed'))::int AS blogs_unchecked,
       (SELECT count(*) FROM papers WHERE first_seen_at >= $1 AND first_seen_at < $2 AND confirm_status <> 'confirmed')::int AS unconfirmed`,
    [ws, we],
  );
  return { ...totals!, topics };
}

export interface ItemView {
  id: number;
  paper_id: number;
  topic_id: number;
  title: string;
  url: string;
  one_line: string | null;
  pub_status: string;
  venue: string | null;
  relevance: string;
  importance_status: string;
  type: string | null;
  score: number | null;
  reason_line1: string | null;
  reason_line2: string | null;
  rank: number | null;
  in_brief: boolean;
  also_shown_in: number | null; // shown in full under this topic; here only "Also relevant here"
  about: string | null; // "What it's about" (papers shown in full only)
  older: boolean;
  published_year: number | null;
  citations: number | null;
  influential_citations: number | null;
  s2_status: string;
  author_info: string | null;
  hf_upvotes: number | null;
  hf_status: string;
  code_url: string | null;
  blog_count: number;
  discussed_in: { title: string; url: string }[];
  marks: string[];
}

export async function briefItems(briefId: number, onlyInBrief: boolean): Promise<ItemView[]> {
  return q<ItemView>(
    `SELECT bi.id, bi.paper_id, bi.topic_id, p.title, p.url, p.one_line, p.pub_status, COALESCE(p.venue, bi.s2_venue, p.journal_ref) AS venue,
       bi.relevance, bi.importance_status, bi.type, bi.score, bi.reason_line1, bi.reason_line2, bi.rank, bi.in_brief, bi.also_shown_in, bi.about, bi.older, bi.published_year,
       bi.citations, bi.influential_citations, bi.s2_status, bi.author_info, bi.hf_upvotes, bi.hf_status,
       COALESCE(bi.code_url, p.code_url) AS code_url, bi.blog_count,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('title', b.title, 'url', b.url) ORDER BY b.id)
                 FROM blogs b WHERE b.linked_paper_id = p.id), '[]'::jsonb) AS discussed_in,
       COALESCE((SELECT array_agg(m.kind) FROM marks m WHERE m.paper_id = p.id AND m.kind <> 'missed'), '{}') AS marks
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id
     WHERE bi.brief_id = $1 AND ($2::boolean IS FALSE OR bi.in_brief OR bi.also_shown_in IS NOT NULL)
     ORDER BY bi.topic_id, bi.rank NULLS LAST, bi.id`,
    [briefId, onlyInBrief],
  );
}

/** Plain-fact line for a paper: Preprint/Peer-reviewed, citations, upvotes, code, blogs. */
export function facts(i: ItemView): string[] {
  const out: string[] = [];
  out.push(i.pub_status === "peer_reviewed" ? `Peer-reviewed${i.venue ? ` (${i.venue})` : ""}` : "Preprint");
  if (i.s2_status === "ok") out.push(`Cited ${i.citations ?? 0} times (${i.influential_citations ?? 0} influential)`);
  else if (i.s2_status === "not_found") out.push("Citations: not yet indexed");
  else out.push("Citations: not available");
  if (i.hf_status === "ok") out.push(`${i.hf_upvotes ?? 0} upvotes on Hugging Face`);
  else if (i.hf_status === "not_listed") out.push("Not featured on Hugging Face");
  else out.push("Upvotes: not available");
  out.push(i.code_url ? "Code shared" : "No code link found");
  out.push(`${i.blog_count} blog${i.blog_count === 1 ? "" : "s"} discussing it`);
  return out;
}

/**
 * The facts line on a paper card (brief-format.md): type · score · Preprint/Peer-reviewed · citations ·
 * upvotes · code shared · "Discussed in" if any.
 */
export function cardFacts(i: ItemView): string[] {
  const f = facts(i);
  const out = [i.type ? TYPE_LABEL[i.type] : "", i.score !== null ? `score ${i.score}/10 (suggested)` : "", ...f.slice(0, 4)];
  if (i.discussed_in.length) out.push(`Discussed in: ${i.discussed_in.map((b) => b.title).join("; ")}`);
  return out.filter(Boolean);
}

/** "What it's about" — falls back to the one-line summary if the writing step had no answer. */
export function aboutText(i: ItemView): string {
  return i.about ?? i.one_line ?? "";
}

export interface BriefRow {
  id: number;
  week_start: string;
  week_end: string;
  status: string;
  created_at: string;
  per_topic: Record<string, unknown>;
  whats_changing: Record<string, string>;
  papers_checked: number;
  papers_ranked: number;
  gemini_calls: number;
  gemini_cost_usd: string;
  sent_at: string | null;
  email_status: string | null;
  written_by: string | null;
  dashboard_json: DashboardBrief | null;
}

export interface DashboardTopic {
  topic_id: number;
  name: string;
  whats_changing: string;
  quiet: boolean;
  in_brief: number[]; // brief_item ids shown in full
  also: number[]; // brief_item ids shown as "Also relevant here" (in full under another topic)
  more_count: number;
  counts: TopicCounts;
}

export interface DashboardBrief {
  label: string;
  topline: WindowCounts;
  topics: DashboardTopic[];
  footer: string;
}

export function buildDashboardBrief(label: string, counts: WindowCounts, items: ItemView[], whats: Record<string, string>): DashboardBrief {
  return {
    label,
    topline: counts,
    footer: FOOTER,
    topics: counts.topics.map((t) => {
      const top = items.filter((i) => i.topic_id === t.topic_id && i.in_brief);
      const also = items.filter((i) => i.topic_id === t.topic_id && i.also_shown_in !== null);
      const anyRelevant = t.relevant > 0;
      return {
        topic_id: t.topic_id,
        name: t.name,
        whats_changing: whats[String(t.topic_id)] ?? emptyTopicSentence(t),
        quiet: anyRelevant && top.length === 0 && also.length === 0,
        in_brief: top.map((i) => i.id),
        also: also.map((i) => i.id),
        more_count: Math.max(0, t.checked + t.older - top.length),
        counts: t,
      };
    }),
  };
}

export function emptyTopicSentence(t: TopicCounts): string {
  if (t.checked === 0 && t.older > 0) return `No new papers this week; ${t.older} older paper${t.older === 1 ? " was" : "s were"} discussed.`;
  if (t.checked === 0) return "No papers were found for this topic this week.";
  if (t.relevant === 0 && t.not_assessed + t.pending > 0)
    return `No paper has been judged on-topic yet; ${t.not_assessed + t.pending} of ${t.checked} are still waiting for or failed the AI check.`;
  if (t.relevant === 0) return `None of the ${t.checked} papers checked was judged on-topic this week.`;
  return "Not written this week (the AI writing step was unavailable) — see the papers below.";
}

// ---------- Email ----------

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function toplineText(c: WindowCounts): string[] {
  const lines = [
    `Papers checked: ${c.papers_checked.toLocaleString("en-IN")} new — ${c.topics.map((t) => `${t.name} ${t.checked}`).join(" · ")}`,
    `Blogs checked: ${c.blogs_checked} · blogs with no paper: ${c.blogs_no_paper}${c.blogs_unchecked ? ` · not yet checked: ${c.blogs_unchecked}` : ""}`,
  ];
  if (c.older_discussed) lines.push(`Older papers discussed this week (via blogs / research sites, not counted above): ${c.older_discussed}`);
  const zero = c.topics.filter((t) => t.checked === 0).map((t) => t.name);
  lines.push(zero.length ? `Topics with 0 papers: ${zero.join(", ")}` : "Topics with 0 papers: none");
  const waiting = c.topics.reduce((s, t) => s + t.pending, 0);
  const notAssessed = c.topics.reduce((s, t) => s + t.not_assessed, 0);
  if (waiting || notAssessed) lines.push(`Still waiting for the relevance check: ${waiting} · not assessed (AI check failed): ${notAssessed}`);
  return lines;
}

/** Signed one-click feedback link (see app/api/mark/route.ts). */
export function markLink(base: string, itemId: number, kind: (typeof MARK_KINDS)[number]): string {
  return `${base}/api/mark?t=${encodeURIComponent(makeMarkToken(itemId, kind))}`;
}

export function renderEmail(briefId: number, d: DashboardBrief, items: ItemView[], base = appUrl()): { subject: string; html: string; text: string } {
  const subject = `Research Pulse — ${d.label}`;
  const byId = new Map(items.map((i) => [i.id, i]));
  const topicName = new Map(d.topics.map((x) => [x.topic_id, x.name]));
  const h: string[] = [];
  const t: string[] = [];
  const btn = "display:inline-block;margin:6px 6px 0 0;padding:5px 10px;border:1px solid #cbd5e1;border-radius:6px;color:#1f2937;text-decoration:none;font-size:13px";

  h.push(`<div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:680px;margin:0 auto;color:#1f2937;line-height:1.5">`);
  h.push(`<h1 style="font-size:20px;margin:0 0 4px">Research Pulse</h1><div style="color:#6b7280;margin-bottom:12px">Week of ${esc(d.label)}</div>`);
  h.push(`<div style="background:#f3f4f6;border-radius:8px;padding:10px 14px;font-size:13px">${toplineText(d.topline).map(esc).join("<br>")}</div>`);
  t.push(`RESEARCH PULSE — week of ${d.label}`, "", ...toplineText(d.topline), "");

  for (const topic of d.topics) {
    const more = `${base}/papers?brief=${briefId}&topic=${topic.topic_id}`;
    h.push(`<h2 style="font-size:16px;margin:26px 0 4px;border-bottom:1px solid #e5e7eb;padding-bottom:4px">${esc(topic.name)}</h2>`);
    h.push(`<p style="margin:4px 0 10px"><b>What's changing:</b> ${esc(topic.whats_changing)}</p>`);
    t.push(`== ${topic.name.toUpperCase()} ==`, `What's changing: ${topic.whats_changing}`);
    if (topic.quiet) {
      h.push(`<p style="margin:4px 0;color:#6b7280"><b>Quiet week</b> — no paper scored 5 or more.</p>`);
      t.push("Quiet week — no paper scored 5 or more.");
    }
    for (const id of topic.in_brief) {
      const i = byId.get(id);
      if (!i) continue;
      h.push(`<div style="margin:12px 0 16px;padding-left:12px;border-left:3px solid #2563eb">`);
      h.push(`<a href="${esc(i.url)}" style="font-weight:600;font-size:15px;color:#1d4ed8;text-decoration:none">${esc(i.title)}</a>`);
      if (i.older) h.push(`<div style="font-size:12px;color:#b45309">${esc(olderLabel(i.published_year))}</div>`);
      h.push(`<div style="font-size:12px;color:#6b7280;margin-top:2px">${cardFacts(i).map(esc).join(" · ")}${i.code_url ? ` · <a href="${esc(i.code_url)}" style="color:#6b7280">code</a>` : ""}</div>`);
      h.push(`<p style="font-size:14px;margin:6px 0 2px"><b>What it's about:</b> ${esc(aboutText(i))}</p>`);
      h.push(`<p style="font-size:14px;margin:2px 0"><b>Why it may matter:</b> ${esc(i.reason_line2)}</p>`);
      h.push(`<div>${MARK_KINDS.map((k) => `<a href="${markLink(base, i.id, k)}" style="${btn}">${esc(MARK_LABEL[k])}</a>`).join("")}</div>`);
      h.push(`</div>`);
      t.push(
        "",
        `• ${i.title}`,
        ...(i.older ? [`  [${olderLabel(i.published_year)}]`] : []),
        `  ${i.url}`,
        `  ${cardFacts(i).join(" · ")}`,
        `  What it's about: ${aboutText(i)}`,
        `  Why it may matter: ${i.reason_line2}`,
        ...MARK_KINDS.map((k) => `  ${MARK_LABEL[k]}: ${markLink(base, i.id, k)}`),
      );
    }
    for (const id of topic.also) {
      const i = byId.get(id);
      if (!i) continue;
      const where = topicName.get(i.also_shown_in ?? -1) ?? "another topic";
      h.push(`<p style="font-size:13px;margin:6px 0">Also relevant here: <a href="${esc(i.url)}" style="color:#1d4ed8">${esc(i.title)}</a> (see ${esc(where)})</p>`);
      t.push("", `Also relevant here: ${i.title} (see ${where})`);
    }
    h.push(`<a href="${more}" style="font-size:13px;color:#1d4ed8">+ ${topic.more_count} more papers checked</a>`);
    t.push("", `+ ${topic.more_count} more papers checked: ${more}`, "");
  }

  h.push(`<p style="margin-top:28px;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:10px">${esc(FOOTER)}</p>`);
  h.push(`<p style="font-size:13px;color:#6b7280">Something important missing? <a href="${base}/#missed">You missed this?</a> · <a href="${base}/">Open the dashboard</a> · Feedback links work for 14 days.</p></div>`);
  t.push(FOOTER, `You missed this? ${base}/#missed`, `Dashboard: ${base}/`);
  return { subject, html: h.join("\n"), text: t.join("\n") };
}

export function briefLabel(b: { week_start: string | Date; week_end: string | Date }): string {
  return weekLabel(new Date(b.week_start), new Date(b.week_end));
}
