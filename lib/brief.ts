// The brief as data (shared by the email and the dashboard) and its email rendering.
// Facts and counts come straight from Neon (lib/numbers.ts defines every count); Gemini's words are
// only the summary, "What's changing", themes, and each picked paper's plain text and client angle.
import { q, q1 } from "./db";
import { appUrl } from "./env";
import { weekLabel } from "./time";
import { MARK_KINDS, MARK_LABEL, makeMarkToken } from "./markToken";
import { dehype } from "./plain";
import { briefNumbers, olderSql, readMinutes, type BriefNumbers } from "./numbers";

export { olderSql };
import { TIER_LABEL, type Tier } from "./steps/rank";
import { EVIDENCE_LABEL, type SummaryLine, type Theme } from "./steps/write";

export type { SummaryLine, Theme };

export const TYPE_LABEL: Record<string, string> = {
  new_test: "New test",
  surprising_result: "Surprising result",
  new_way_to_see_problem: "New way to see the problem",
  nothing_new: "Nothing new",
};

export const FOOTER = "This brief suggests. You decide what to read and what to share.";

export function olderLabel(year: number | null): string {
  return `Older paper${year ? ` (${year})` : ""} — discussed this week`;
}

export interface TopicCounts {
  topic_id: number;
  name: string;
  checked: number; // scanned for this topic (new papers)
  relevant: number; // judged on-topic for this topic
  not_relevant: number;
  not_assessed: number;
  pending: number;
  older: number; // older papers discussed this week (not in "checked")
}

export interface WindowCounts {
  papers_checked: number; // "scanned": unique NEW research papers
  on_topic: number; // unique new papers on-topic for at least one active topic
  older_discussed: number;
  topics: TopicCounts[];
  blogs_checked: number;
  blogs_with_paper: number;
  blogs_no_paper: number;
  blogs_unchecked: number;
  unconfirmed: number;
}

/** The week's counts (by when papers were first found, `ws` ≤ t < `we`). One definition: lib/numbers.ts. */
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
       WHERE p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed' AND p.is_research_paper
     ) pt ON pt.topic_id = t.id
     WHERE t.active GROUP BY t.id ORDER BY t.sort_order, t.id`,
    [ws, we],
  );
  const NEW = `p.first_seen_at >= $1 AND p.first_seen_at < $2 AND p.confirm_status = 'confirmed' AND p.is_research_paper`;
  const totals = await q1<Omit<WindowCounts, "topics">>(
    `SELECT
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
          JOIN topics t ON t.id = pt.topic_id AND t.active WHERE ${NEW} AND NOT ${olderSql("p", "$1")})::int AS papers_checked,
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
          JOIN topics t ON t.id = pt.topic_id AND t.active
        WHERE ${NEW} AND NOT ${olderSql("p", "$1")} AND pt.status = 'assessed' AND pt.relevant)::int AS on_topic,
       (SELECT count(DISTINCT pt.paper_id) FROM paper_topics pt JOIN papers p ON p.id = pt.paper_id
          JOIN topics t ON t.id = pt.topic_id AND t.active WHERE ${NEW} AND ${olderSql("p", "$1")})::int AS older_discussed,
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
  score: number | null; // internal: ranking only, never shown
  reason_line1: string | null;
  reason_line2: string | null;
  rank: number | null;
  in_brief: boolean; // picked
  tier: Tier | null;
  also_shown_in: number | null;
  also_topics: number[]; // other topics this paper is on-topic for ("also relevant to")
  about: string | null;
  why: string | null;
  audience: string | null;
  evidence: number | null; // 1 Lab result · 2 Benchmark · 3 Real deployment
  say: string | null;
  affiliation: string | null;
  first_author: string | null;
  author_count: number;
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
       bi.relevance, bi.importance_status, bi.type, bi.score, bi.reason_line1, bi.reason_line2, bi.rank, bi.in_brief, bi.tier, bi.also_shown_in,
       COALESCE((SELECT array_agg(o.topic_id ORDER BY t.sort_order, t.id) FROM brief_items o JOIN topics t ON t.id = o.topic_id
                 WHERE o.brief_id = bi.brief_id AND o.paper_id = bi.paper_id AND o.topic_id <> bi.topic_id AND o.relevance = 'yes'), '{}') AS also_topics,
       bi.about, bi.why, bi.audience, bi.evidence, bi.say, bi.affiliation,
       p.authors[1] AS first_author, COALESCE(cardinality(p.authors), 0) AS author_count,
       bi.older, bi.published_year, bi.citations, bi.influential_citations, bi.s2_status, bi.author_info, bi.hf_upvotes, bi.hf_status,
       COALESCE(bi.code_url, p.code_url) AS code_url, bi.blog_count,
       COALESCE((SELECT jsonb_agg(jsonb_build_object('title', b.title, 'url', b.url) ORDER BY b.id)
                 FROM blogs b WHERE b.linked_paper_id = p.id), '[]'::jsonb) AS discussed_in,
       COALESCE((SELECT array_agg(m.kind) FROM marks m WHERE m.paper_id = p.id AND m.kind <> 'missed'), '{}') AS marks
     FROM brief_items bi JOIN papers p ON p.id = bi.paper_id
     WHERE bi.brief_id = $1 AND ($2::boolean IS FALSE OR bi.in_brief)
     ORDER BY bi.topic_id, bi.tier NULLS LAST, bi.rank NULLS LAST, bi.id`,
    [briefId, onlyInBrief],
  );
}

/** The lab: Semantic Scholar's institutions; else "First Author et al."; never invented. */
export function labText(i: Pick<ItemView, "affiliation" | "first_author" | "author_count">): string | null {
  if (i.affiliation) return i.affiliation;
  if (!i.first_author) return null;
  return i.author_count > 1 ? `${i.first_author} et al.` : i.first_author;
}

/** Facts worth showing: Peer-reviewed venue, and citations / upvotes / blogs only when above zero. */
export function signals(i: ItemView): string[] {
  const out: string[] = [];
  if (i.pub_status === "peer_reviewed") out.push(`Peer-reviewed${i.venue ? ` (${i.venue})` : ""}`);
  if ((i.citations ?? 0) > 0) out.push(`Cited ${i.citations} time${i.citations === 1 ? "" : "s"}`);
  if ((i.hf_upvotes ?? 0) > 0) out.push(`${i.hf_upvotes} upvote${i.hf_upvotes === 1 ? "" : "s"} on Hugging Face`);
  if (i.code_url) out.push("Code shared");
  if (i.blog_count > 0) out.push(`${i.blog_count} blog${i.blog_count === 1 ? "" : "s"} discussing it`);
  return out;
}

export const evidenceLabel = (e: number | null) => (e && e >= 1 && e <= 3 ? EVIDENCE_LABEL[e - 1] : null);
export const tierLabel = (t: Tier | null) => (t ? TIER_LABEL[t] : null);

/** "What it's about" — falls back to the one-line summary if the writing step had no answer. */
export function aboutText(i: ItemView): string {
  return dehype(i.about ?? i.one_line ?? "");
}

/** "Why it matters" — the plain rewrite, else Question 2's line 2 with hype words removed. */
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
  in_brief: number[]; // brief_item ids picked under this topic (tier, then rank)
  also: number[]; // (earlier briefs only)
  more_count: number; // on-topic for this topic − shown here
  counts: TopicCounts;
  themes?: Theme[];
}

export interface DashboardBrief {
  version?: number; // 2 = redesign (summary, tiers, numbers)
  label: string;
  topline: WindowCounts;
  topics: DashboardTopic[];
  footer: string;
  summary?: SummaryLine[];
  numbers?: BriefNumbers;
  top?: number[]; // brief_item ids "Bring to a client", strongest first
  read_minutes?: number;
}

export function buildDashboardBrief(
  label: string,
  counts: WindowCounts,
  items: ItemView[],
  whats: Record<string, string>,
  extra: { summary?: SummaryLine[]; themes?: Record<string, Theme[]> } = {},
): DashboardBrief {
  const picked = items.filter((i) => i.in_brief);
  const numbers = briefNumbers(counts, picked);
  const topics = counts.topics.map((t) => {
    const mine = picked.filter((i) => i.topic_id === t.topic_id);
    const n = numbers.topics.find((x) => x.topic_id === t.topic_id)!;
    return {
      topic_id: t.topic_id,
      name: t.name,
      whats_changing: whats[String(t.topic_id)] ?? emptyTopicSentence(t),
      quiet: t.relevant > 0 && mine.length === 0,
      in_brief: mine.map((i) => i.id),
      also: [],
      more_count: n.more,
      counts: t,
      themes: extra.themes?.[String(t.topic_id)] ?? [],
    };
  });
  const order = (a: ItemView, b: ItemView) => (a.tier ?? 9) - (b.tier ?? 9) || (b.score ?? 0) - (a.score ?? 0) || (a.rank ?? 0) - (b.rank ?? 0);
  const top = picked.filter((i) => i.tier === 1).sort(order).map((i) => i.id);
  const summary = extra.summary ?? [];
  const read_minutes = readMinutes([
    ...summary.flatMap((s) => [s.lead, s.detail]),
    ...topics.flatMap((t) => [t.whats_changing, ...(t.themes ?? []).map((x) => x.tag)]),
    ...picked.flatMap((i) => [i.title, labText(i), whyText(i), ...(i.tier === 1 ? [i.say, i.audience] : [])]),
  ]);
  return { version: 2, label, topline: counts, footer: FOOTER, topics, summary, numbers, top, read_minutes };
}

export function emptyTopicSentence(t: TopicCounts): string {
  if (t.checked === 0 && t.older > 0) return `No new papers this week; ${t.older} older paper${t.older === 1 ? " was" : "s were"} discussed.`;
  if (t.checked === 0) return "No papers were found for this topic this week.";
  if (t.relevant === 0 && t.not_assessed + t.pending > 0)
    return `No paper has been judged on-topic yet; ${t.not_assessed + t.pending} of ${t.checked} are still waiting for or failed the AI check.`;
  if (t.relevant === 0) return `None of the ${t.checked} papers checked was judged on-topic this week.`;
  return "Not written this week (the AI writing step was unavailable) — see the papers below.";
}

/** "999 scanned → 500 on her topics → 18 picked" (one line; details live on Cost & coverage). */
export function funnelLine(n: { scanned: number; on_topic: number; picked: number }, whose = "her"): string {
  const f = (x: number) => x.toLocaleString("en-IN");
  return `${f(n.scanned)} scanned → ${f(n.on_topic)} on ${whose} topics → ${f(n.picked)} picked`;
}

// ---------- Email ----------

const esc = (s: string | null | undefined) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Signed one-click feedback link (see app/api/mark/route.ts). */
export function markLink(base: string, itemId: number, kind: (typeof MARK_KINDS)[number]): string {
  return `${base}/api/mark?t=${encodeURIComponent(makeMarkToken(itemId, kind))}`;
}

// Email-safe styles (inline only; tables for layout; max 640px). Same pastel look as the dashboard.
const E = {
  font: "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif",
  text: "#2a2540",
  muted: "#6b6585",
  faint: "#9a94b0",
  line: "#ebe6f3",
  accent: "#6a58c8",
  accentSoft: "#ede9fb",
};
const TIER_COLOR: Record<Tier, [string, string]> = { 1: ["#fbe7ee", "#a84468"], 2: ["#ede9fb", "#5a49b8"], 3: ["#f1eef6", "#6b6585"] };
const pill = (label: string, bg: string, fg: string) =>
  `<span style="display:inline-block;margin:0 6px 4px 0;padding:2px 9px;border-radius:999px;background:${bg};color:${fg};font-size:12px;font-weight:600;line-height:18px">${esc(label)}</span>`;
const tierPill = (t: Tier | null) => (t ? pill(TIER_LABEL[t], ...TIER_COLOR[t]) : "");
const meterHtml = (e: number | null) =>
  e
    ? `<span style="white-space:nowrap">${[1, 2, 3].map((k) => `<span style="display:inline-block;width:14px;height:5px;border-radius:3px;margin-right:2px;vertical-align:middle;background:${k <= e ? E.accent : E.line}"></span>`).join("")} <span style="font-size:12px;color:${E.muted}">${esc(evidenceLabel(e))}</span></span>`
    : "";
const meterText = (e: number | null) => (e ? `${"■".repeat(e)}${"□".repeat(3 - e)} ${evidenceLabel(e)}` : "");
const emailLabel = (s: string) =>
  `<div style="font-size:11px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${E.faint};margin:12px 0 3px">${s}</div>`;

export function renderEmail(briefId: number, d: DashboardBrief, items: ItemView[], base = appUrl()): { subject: string; html: string; text: string } {
  const subject = `Research Pulse — ${d.label}`;
  const byId = new Map(items.map((i) => [i.id, i]));
  const topicName = new Map(d.topics.map((x) => [x.topic_id, x.name]));
  const n = d.numbers ?? briefNumbers(d.topline, items.filter((i) => i.in_brief));
  const h: string[] = [];
  const t: string[] = [];
  const btn = `display:inline-block;margin:0 6px 6px 0;padding:7px 13px;border:1px solid #cfd5de;border-radius:999px;background:#ffffff;color:${E.text};text-decoration:none;font-size:13px;font-weight:600`;
  const links = (i: ItemView) => `<div style="margin-top:10px">${MARK_KINDS.map((k) => `<a href="${markLink(base, i.id, k)}" style="${btn}">${esc(MARK_LABEL[k])}</a>`).join("")}</div>`;
  const linksText = (i: ItemView) => MARK_KINDS.map((k) => `  ${MARK_LABEL[k]}: ${markLink(base, i.id, k)}`);
  const also = (i: ItemView) => i.also_topics.map((id) => topicName.get(id)).filter(Boolean).join(", ");
  const top = (d.top ?? []).map((id) => byId.get(id)).filter((i): i is ItemView => !!i);

  h.push(`<div style="margin:0;padding:24px 12px;background:#f7f5fb;font-family:${E.font};color:${E.text};line-height:1.55">`);
  h.push(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:640px;margin:0 auto;border-collapse:collapse"><tr><td>`);

  // Masthead + one stats line
  h.push(`<div style="padding:0 6px 6px"><div style="font-size:13px;color:${E.muted}"><b style="color:${E.text}">Research Pulse</b> · Kavita's weekly AI research brief</div>`);
  h.push(`<div style="font-size:26px;font-weight:700;margin-top:4px;line-height:1.2">Week of ${esc(d.label)}</div>`);
  h.push(`<div style="font-size:13px;color:${E.muted};margin-top:6px">${d.read_minutes ? `<b style="color:${E.text}">~${d.read_minutes} min</b> read · ` : ""}<b style="color:${E.text}">${top.length}</b> to bring to a client · ${esc(funnelLine(n, "your"))}</div></div>`);
  t.push(`RESEARCH PULSE — week of ${d.label}`, `${d.read_minutes ? `~${d.read_minutes} min read · ` : ""}${top.length} to bring to a client · ${funnelLine(n, "your")}`, "");

  // This week in 30 seconds
  if (d.summary?.length) {
    h.push(`<div style="margin:16px 6px 0;padding:16px 20px;background:#ffffff;border:1px solid ${E.line};border-radius:12px">`);
    h.push(`<div style="font-size:16px;font-weight:700;margin-bottom:6px">This week in 30 seconds</div><ol style="margin:0;padding-left:20px">`);
    for (const s of d.summary)
      h.push(`<li style="margin:6px 0;font-size:14px"><b>${esc(s.lead)}</b> ${esc(s.detail)} <span style="color:${E.faint}">${esc(s.topic_ids.map((id) => topicName.get(id)).filter(Boolean).join(" · "))}</span></li>`);
    h.push(`</ol></div>`);
    t.push("THIS WEEK IN 30 SECONDS", ...d.summary.map((s, k) => `${k + 1}. ${s.lead} ${s.detail}`), "");
  }

  // Bring to a client: the top 3 first, with the client angle
  if (top.length) {
    h.push(`<div style="padding:26px 6px 4px"><div style="font-size:19px;font-weight:700">Bring to a client</div><div style="font-size:12px;color:${E.faint}">At most 3 a week, across all topics</div></div>`);
    t.push("BRING TO A CLIENT");
    for (const i of top) {
      const lab = labText(i);
      h.push(`<div style="margin:10px 6px 12px;background:#ffffff;border:1px solid ${E.line};border-left:4px solid #f0a3bd;border-radius:12px;padding:16px 18px">`);
      h.push(`<div>${tierPill(1)}<span style="font-size:12px;color:${E.faint}">${esc(topicName.get(i.topic_id))}</span></div>`);
      h.push(`<a href="${esc(i.url)}" style="font-size:16px;font-weight:700;line-height:1.35;color:${E.text};text-decoration:none">${esc(i.title)}</a>`);
      if (lab) h.push(`<div style="font-size:12.5px;color:${E.muted};margin-top:2px">${esc(lab)}</div>`);
      h.push(`<div style="font-size:14px;margin-top:8px">${esc(whyText(i))}</div>`);
      if (i.audience) h.push(`${emailLabel("Who it matters to")}<div style="font-size:14px">${esc(i.audience)}</div>`);
      if (i.say) h.push(`${emailLabel("Say it in the meeting")}<div style="font-size:14px;border-left:3px solid #f0a3bd;padding-left:10px">${esc(i.say)}</div>`);
      if (i.evidence) h.push(`${emailLabel("How strong the evidence is")}${meterHtml(i.evidence)}`);
      h.push(links(i), `</div>`);
      t.push(
        "",
        `• ${i.title}`,
        `  ${i.url}`,
        ...(lab ? [`  ${lab}`] : []),
        `  Why it matters: ${whyText(i)}`,
        ...(i.audience ? [`  Who it matters to: ${i.audience}`] : []),
        ...(i.say ? [`  Say it in the meeting: ${i.say}`] : []),
        ...(i.evidence ? [`  Evidence: ${meterText(i.evidence)}`] : []),
        ...linksText(i),
      );
    }
    t.push("");
  }

  // By topic: one line per picked paper
  h.push(`<div style="padding:22px 6px 0"><div style="font-size:19px;font-weight:700">By topic</div><div style="font-size:12px;color:${E.faint}">Papers can fit more than one topic; each is shown once</div></div>`);
  for (const topic of d.topics) {
    const more = `${base}/papers?brief=${briefId}&topic=${topic.topic_id}&status=more`;
    const tn = n.topics.find((x) => x.topic_id === topic.topic_id);
    h.push(`<div style="padding:20px 6px 0"><div style="font-size:17px;font-weight:700">${esc(topic.name)}</div>`);
    h.push(`<div style="font-size:12px;color:${E.faint}">${tn ? `${tn.on_topic.toLocaleString("en-IN")} on-topic of ${tn.scanned.toLocaleString("en-IN")} scanned` : ""}</div>`);
    h.push(`<div style="margin:8px 0 10px;padding:10px 14px;background:${E.accentSoft};border-left:3px solid ${E.accent};border-radius:0 8px 8px 0;font-size:14px"><b style="color:${E.accent}">What's changing:</b> ${esc(topic.whats_changing)}</div></div>`);
    t.push(`== ${topic.name.toUpperCase()} ==`, `What's changing: ${topic.whats_changing}`);
    if (topic.themes?.length) {
      h.push(`<div style="padding:0 6px 6px">${topic.themes.map((th) => pill(`${th.recurring ? "↻ " : ""}${th.tag}`, "#f6f3fb", E.muted)).join("")}</div>`);
      t.push(`Themes: ${topic.themes.map((th) => `${th.recurring ? "↻ " : ""}${th.tag}`).join(" · ")}`);
    }
    if (topic.quiet) {
      h.push(`<div style="padding:0 6px 8px;font-size:14px;color:${E.muted}">Quiet week — no paper scored high enough to pick.</div>`);
      t.push("Quiet week — no paper scored high enough to pick.");
    }
    for (const id of topic.in_brief) {
      const i = byId.get(id);
      if (!i) continue;
      const lab = labText(i);
      const sig = signals(i);
      const alsoTxt = also(i);
      h.push(`<div style="margin:0 6px 10px;background:#ffffff;border:1px solid ${E.line};border-radius:12px;padding:14px 16px">`);
      h.push(`<div>${tierPill(i.tier)}</div><a href="${esc(i.url)}" style="font-size:15px;font-weight:700;line-height:1.35;color:${E.text};text-decoration:none">${esc(i.title)}</a>`);
      h.push(`<div style="font-size:14px;margin-top:4px">${esc(whyText(i))}</div>`);
      const meta = [lab, ...sig, alsoTxt ? `Also relevant to: ${alsoTxt}` : ""].filter(Boolean);
      if (meta.length) h.push(`<div style="font-size:12px;color:${E.muted};margin-top:6px">${meta.map(esc).join(" · ")}</div>`);
      h.push(links(i), `</div>`);
      t.push("", `• [${i.tier ? TIER_LABEL[i.tier] : "Picked"}] ${i.title}`, `  ${i.url}`, ...(meta.length ? [`  ${meta.join(" · ")}`] : []), `  Why it matters: ${whyText(i)}`, ...linksText(i));
    }
    h.push(`<div style="padding:2px 6px 0"><a href="${more}" style="font-size:14px;font-weight:600;color:${E.accent};text-decoration:none">+ ${topic.more_count} more on-topic papers →</a></div>`);
    t.push("", `+ ${topic.more_count} more on-topic papers: ${more}`, "");
  }

  h.push(`<div style="margin:32px 6px 0;padding-top:14px;border-top:1px solid ${E.line};font-size:13px;color:${E.muted};text-align:center">${esc(FOOTER)}<br>`);
  h.push(`Nothing is hidden: <a href="${base}/papers?brief=${briefId}" style="color:${E.accent}">see every paper</a> · <a href="${base}/#missed" style="color:${E.accent}">You missed this?</a> · <a href="${base}/" style="color:${E.accent}">Open the dashboard</a><br>Feedback links work for 14 days.</div>`);
  h.push(`</td></tr></table></div>`);
  t.push(FOOTER, `Every paper: ${base}/papers?brief=${briefId}`, `You missed this? ${base}/#missed`, `Dashboard: ${base}/`);
  return { subject, html: h.join("\n"), text: t.join("\n") };
}

export function briefLabel(b: { week_start: string | Date; week_end: string | Date }): string {
  return weekLabel(new Date(b.week_start), new Date(b.week_end));
}
