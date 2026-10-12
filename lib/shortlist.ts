// Client shortlist: papers marked "Share with a client", their client / mandate tags, and the
// one-page export (printable page, Markdown, PDF) — all three built from the same rows.
import { PDFDocument, StandardFonts, rgb, type PDFFont } from "pdf-lib";
import { q } from "./db";
import { evidenceLabel, labText, tierLabel } from "./brief";
import type { Tier } from "./steps/rank";

export interface ShortRow {
  paper_id: number;
  title: string;
  url: string;
  topic: string | null;
  topic_id: number | null;
  marked_at: string;
  tier: Tier | null;
  affiliation: string | null;
  first_author: string | null;
  author_count: number;
  about: string | null;
  why: string | null;
  audience: string | null;
  say: string | null;
  evidence: number | null;
  one_line: string | null;
  reason_line2: string | null;
  tags: string[];
  marks: string[];
}

/** Tags: trimmed, single spaces, at most 60 characters. */
export function normalizeTag(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

export async function shortlistRows(tag: string | null): Promise<ShortRow[]> {
  return q<ShortRow>(
    `SELECT p.id AS paper_id, p.title, p.url, t.name AS topic, m.topic_id, m.created_at AS marked_at,
       bi.tier, bi.affiliation, p.authors[1] AS first_author, COALESCE(cardinality(p.authors), 0) AS author_count,
       bi.about, bi.why, bi.audience, bi.say, bi.evidence, p.one_line, bi.reason_line2,
       COALESCE((SELECT array_agg(st.tag ORDER BY lower(st.tag)) FROM shortlist_tags st WHERE st.paper_id = p.id), '{}') AS tags,
       COALESCE((SELECT array_agg(x.kind) FROM marks x WHERE x.paper_id = p.id AND x.kind <> 'missed'), '{}') AS marks
     FROM marks m
     JOIN papers p ON p.id = m.paper_id
     LEFT JOIN topics t ON t.id = m.topic_id
     LEFT JOIN LATERAL (SELECT * FROM brief_items b WHERE b.paper_id = p.id AND b.importance_status = 'assessed'
                        ORDER BY (b.about IS NOT NULL) DESC, b.id DESC LIMIT 1) bi ON TRUE
     WHERE m.kind = 'share'
       AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM shortlist_tags st WHERE st.paper_id = p.id AND lower(st.tag) = lower($1)))
     ORDER BY m.created_at DESC`,
    [tag],
  );
}

/** Every tag in use (case-insensitive), with how many shortlisted papers carry it. */
export async function allTags(): Promise<{ tag: string; n: number }[]> {
  return q<{ tag: string; n: number }>(
    `SELECT min(st.tag) AS tag, count(*)::int AS n FROM shortlist_tags st
     WHERE EXISTS (SELECT 1 FROM marks m WHERE m.paper_id = st.paper_id AND m.kind = 'share')
     GROUP BY lower(st.tag) ORDER BY lower(min(st.tag))`,
  );
}

/** The fields of one export entry, in order. */
export function exportEntry(r: ShortRow): { title: string; url: string; lines: [string, string][] } {
  const lines: [string, string][] = [];
  const meta = [tierLabel(r.tier), r.topic, labText(r)].filter(Boolean).join(" · ");
  if (meta) lines.push(["", meta]);
  const why = r.why ?? r.reason_line2;
  if (why) lines.push(["Why it matters", why]);
  if (r.audience) lines.push(["Who it matters to", r.audience]);
  if (r.say) lines.push(["Say it in the meeting", r.say]);
  if (evidenceLabel(r.evidence)) lines.push(["Evidence", `${evidenceLabel(r.evidence)} (Lab result → Benchmark → Real deployment)`]);
  const about = r.about ?? r.one_line;
  if (about) lines.push(["What it's about", about]);
  return { title: r.title, url: r.url, lines };
}

export function exportTitle(tag: string | null): string {
  return tag ? `Research for ${tag}` : "Client shortlist";
}

export function toMarkdown(tag: string | null, rows: ShortRow[], date: string): string {
  const out = [`# ${exportTitle(tag)}`, "", `Research Pulse · ${date} · ${rows.length} paper${rows.length === 1 ? "" : "s"}`, ""];
  rows.forEach((r, k) => {
    const e = exportEntry(r);
    out.push(`## ${k + 1}. [${e.title}](${e.url})`, "");
    for (const [label, text] of e.lines) out.push(label ? `- **${label}:** ${text}` : `*${text}*`, ...(label ? [] : [""]));
    out.push("");
  });
  out.push("_This shortlist suggests. You decide what reaches a client._", "");
  return out.join("\n");
}

// PDF: standard Helvetica only knows WinAnsi characters, so swap the rest for close equivalents.
function ansi(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/·/g, "|")
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "");
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let cur = "";
  for (const word of ansi(text).split(/\s+/).filter(Boolean)) {
    const next = cur ? `${cur} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= width) cur = next;
    else {
      if (cur) lines.push(cur);
      cur = word;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function toPdf(tag: string | null, rows: ShortRow[], date: string): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(exportTitle(tag));
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  const ink = rgb(0.16, 0.15, 0.25);
  const muted = rgb(0.42, 0.4, 0.52);
  const accent = rgb(0.42, 0.35, 0.78);
  let page = doc.addPage([W, H]);
  let y = H - M;
  const need = (h: number) => {
    if (y - h < M) {
      page = doc.addPage([W, H]);
      y = H - M;
    }
  };
  const text = (s: string, font: PDFFont, size: number, color = ink, indent = 0, gap = 3) => {
    for (const line of wrap(s, font, size, W - 2 * M - indent)) {
      need(size + gap);
      page.drawText(line, { x: M + indent, y: y - size, size, font, color });
      y -= size + gap;
    }
  };
  text(exportTitle(tag), bold, 20, accent);
  y -= 2;
  text(`Research Pulse | ${date} | ${rows.length} paper${rows.length === 1 ? "" : "s"}`, regular, 10, muted);
  y -= 10;
  rows.forEach((r, k) => {
    const e = exportEntry(r);
    need(40);
    page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.6, color: rgb(0.9, 0.88, 0.95) });
    y -= 10;
    text(`${k + 1}. ${e.title}`, bold, 12);
    text(e.url, regular, 8.5, accent);
    for (const [label, body] of e.lines) {
      if (!label) text(body, regular, 9.5, muted);
      else {
        text(label.toUpperCase(), bold, 7.5, muted, 0, 1);
        text(body, regular, 10, ink, 0, 3);
      }
    }
    y -= 8;
  });
  need(20);
  text("This shortlist suggests. You decide what reaches a client.", regular, 9, muted);
  return doc.save();
}
