// The brief as data (shared by the email and the dashboard) and its email rendering.
// Facts and counts come straight from Neon; Gemini's words are only the reasons and "What's changing".
import { q, q1 } from "./db";
import { appUrl } from "./env";
import { weekLabel } from "./time";
import { MARK_KINDS, MARK_LABEL, makeMarkToken } from "./markToken";
import { dehype } from "./plain";

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
  why: string | null; // plain "Why it may matter" (papers shown in full only)
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
       bi.relevance, bi.importance_status, bi.type, bi.score, bi.reason_line1, bi.reason_line2, bi.rank, bi.in_brief, bi.also_shown_in, bi.about, bi.why, bi.older, bi.published_year,
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
  return dehype(i.about ?? i.one_line ?? "");
}

/** "Why it may matter" — the plain rewrite, else Question 2's line 2 with hype words removed. */
export function whyText(i: ItemView): string {
  return dehype(i.why ?? i.reason_line2 ?? "");
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

// Email-safe styles (inline only; tables for layout; max 640px). Same card look as the dashboard.
const E = {
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  text: "#17202c",
  muted: "#5c6878",
  faint: "#8792a1",
  line: "#e2e6ec",
  accent: "#1d4ed8",
  accentSoft: "#eef2fc",
};
const EMAIL_TYPE: Record<string, string> = {
  new_test: "New test",
  surprising_result: "Surprising result",
  new_way_to_see_problem: "New way to see a problem",
};
const pill = (label: string, bg: string, fg: string) =>
  `<span style="display:inline-block;margin:0 6px 6px 0;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600;line-height:18px">${esc(label)}</span>`;
const emailLabel = (s: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${E.faint};margin:14px 0 3px">${s}</div>`;

export function renderEmail(briefId: number, d: DashboardBrief, items: ItemView[], base = appUrl()): { subject: string; html: string; text: string } {
  const subject = `Research Pulse — ${d.label}`;
  const byId = new Map(items.map((i) => [i.id, i]));
  const topicName = new Map(d.topics.map((x) => [x.topic_id, x.name]));
  const h: string[] = [];
  const t: string[] = [];
  const btn = `display:inline-block;margin:0 6px 6px 0;padding:8px 14px;border:1px solid #cfd5de;border-radius:8px;background:#ffffff;color:${E.text};text-decoration:none;font-size:13px;font-weight:600`;
  const inBrief = new Set(items.filter((i) => i.in_brief).map((i) => i.paper_id)).size;
  const tile = (num: string, label: string) =>
    `<td width="50%" style="padding:6px"><div style="background:#ffffff;border:1px solid ${E.line};border-radius:10px;padding:12px 14px">` +
    `<div style="font-size:22px;font-weight:700;color:${E.text};line-height:1.2">${esc(num)}</div>` +
    `<div style="font-size:12px;color:${E.muted}">${esc(label)}</div></div></td>`;

  h.push(`<div style="margin:0;padding:24px 12px;background:#f4f5f7;font-family:${E.font};color:${E.text};line-height:1.55">`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;border-collapse:collapse"><tr><td>`);

  // Header + tiles
  h.push(`<div style="padding:0 6px 6px"><div style="font-size:13px;color:${E.muted}"><b style="color:${E.text}">Research Pulse</b> · Kavita's weekly AI research brief</div>`);
  h.push(`<div style="font-size:24px;font-weight:700;margin-top:4px">Week of ${esc(d.label)}</div></div>`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:6px">`);
  h.push(`<tr>${tile(d.topline.papers_checked.toLocaleString("en-IN"), "papers checked (new)")}${tile(String(d.topics.length), "topics covered")}</tr>`);
  h.push(`<tr>${tile(String(inBrief), "papers in this brief")}${tile(String(d.topline.blogs_checked), `blogs checked · ${d.topline.blogs_no_paper} with no paper`)}</tr></table>`);
  h.push(`<div style="font-size:12px;color:${E.faint};padding:6px 6px 0">${toplineText(d.topline).slice(2).map(esc).join(" · ")}</div>`);
  t.push(`RESEARCH PULSE — week of ${d.label}`, "", ...toplineText(d.topline), "");

  for (const topic of d.topics) {
    const more = `${base}/papers?brief=${briefId}&topic=${topic.topic_id}`;
    h.push(`<div style="padding:28px 6px 0"><div style="font-size:19px;font-weight:700">${esc(topic.name)}</div>`);
    h.push(`<div style="margin:10px 0 14px;padding:10px 14px;background:${E.accentSoft};border-left:3px solid ${E.accent};border-radius:0 8px 8px 0;font-size:14px"><b style="color:${E.accent}">What's changing:</b> ${esc(topic.whats_changing)}</div></div>`);
    t.push(`== ${topic.name.toUpperCase()} ==`, `What's changing: ${topic.whats_changing}`);
    if (topic.quiet) {
      h.push(`<div style="padding:0 6px 8px;font-size:14px;color:${E.muted}">Quiet week — no paper scored 5 or more.</div>`);
      t.push("Quiet week — no paper scored 5 or more.");
    }
    for (const id of topic.in_brief) {
      const i = byId.get(id);
      if (!i) continue;
      const f = facts(i); // [status, citations, upvotes, code, blogs]
      const badges = [
        i.type && EMAIL_TYPE[i.type] ? pill(EMAIL_TYPE[i.type], E.accentSoft, E.accent) : "",
        i.pub_status === "peer_reviewed" ? pill("Peer-reviewed", "#ecf7ef", "#166534") : pill("Preprint", "#f1f3f6", E.muted),
        i.score !== null ? pill(`${i.score}/10 suggested`, "#f1f3f6", E.text) : "",
        i.older ? pill(olderLabel(i.published_year).replace(" — discussed this week", ""), "#f3efe6", "#6b5b3e") : "",
      ].join("");
      const factsLine = [
        i.pub_status === "peer_reviewed" && i.venue ? esc(i.venue) : "",
        esc(f[1]),
        esc(f[2]),
        i.code_url ? `<a href="${esc(i.code_url)}" style="color:${E.muted}">Code shared</a>` : esc(f[3]),
        i.discussed_in.length ? `Discussed in ${i.discussed_in.map((b) => `<a href="${esc(b.url)}" style="color:${E.muted}">${esc(b.title)}</a>`).join(", ")}` : "",
      ].filter(Boolean).join(" · ");
      h.push(`<div style="margin:0 6px 12px;background:#ffffff;border:1px solid ${E.line};border-radius:12px;padding:18px 20px">`);
      h.push(`<a href="${esc(i.url)}" style="font-size:16px;font-weight:700;line-height:1.35;color:${E.text};text-decoration:none">${esc(i.title)}</a>`);
      h.push(`<div style="margin-top:8px">${badges}</div>`);
      h.push(`<div style="font-size:12px;color:${E.muted}">${factsLine}</div>`);
      h.push(`${emailLabel("What it's about")}<div style="font-size:14px">${esc(aboutText(i))}</div>`);
      h.push(`${emailLabel("Why it may matter")}<div style="font-size:14px">${esc(whyText(i))}</div>`);
      h.push(`<div style="margin-top:14px;padding-top:12px;border-top:1px solid ${E.line}">${MARK_KINDS.map((k) => `<a href="${markLink(base, i.id, k)}" style="${btn}">${esc(MARK_LABEL[k])}</a>`).join("")}</div>`);
      h.push(`</div>`);
      t.push(
        "",
        `• ${i.title}`,
        ...(i.older ? [`  [${olderLabel(i.published_year)}]`] : []),
        `  ${i.url}`,
        `  ${cardFacts(i).join(" · ")}`,
        `  What it's about: ${aboutText(i)}`,
        `  Why it may matter: ${whyText(i)}`,
        ...MARK_KINDS.map((k) => `  ${MARK_LABEL[k]}: ${markLink(base, i.id, k)}`),
      );
    }
    for (const id of topic.also) {
      const i = byId.get(id);
      if (!i) continue;
      const where = topicName.get(i.also_shown_in ?? -1) ?? "another topic";
      h.push(`<div style="padding:2px 6px 6px;font-size:13px;color:${E.muted}">Also relevant here: <a href="${esc(i.url)}" style="color:${E.muted}">${esc(i.title)}</a> (see ${esc(where)})</div>`);
      t.push("", `Also relevant here: ${i.title} (see ${where})`);
    }
    h.push(`<div style="padding:6px 6px 0"><a href="${more}" style="font-size:14px;font-weight:600;color:${E.accent};text-decoration:none">+ ${topic.more_count} more papers checked →</a></div>`);
    t.push("", `+ ${topic.more_count} more papers checked: ${more}`, "");
  }

  h.push(`<div style="margin:32px 6px 0;padding-top:14px;border-top:1px solid ${E.line};font-size:13px;color:${E.muted};text-align:center">${esc(FOOTER)}<br>`);
  h.push(`<a href="${base}/#missed" style="color:${E.accent}">You missed this?</a> · <a href="${base}/" style="color:${E.accent}">Open the dashboard</a> · Feedback links work for 14 days.</div>`);
  h.push(`</td></tr></table></div>`);
  t.push(FOOTER, `You missed this? ${base}/#missed`, `Dashboard: ${base}/`);
  return { subject, html: h.join("\n"), text: t.join("\n") };
}

export function briefLabel(b: { week_start: string | Date; week_end: string | Date }): string {
  return weekLabel(new Date(b.week_start), new Date(b.week_end));
}
