// Finds real paper identifiers in URLs and text. Pure functions — no network.
// Only IDs that literally appear in the input are returned; nothing is guessed.

export type LinkKind = "arxiv" | "doi" | "openreview" | "acl" | "cvf" | "ieee";

export interface PaperLink {
  kind: LinkKind;
  id: string; // arXiv ID without version, lowercase DOI, OpenReview forum id, ACL id, IEEE doc number, CVF url
  url: string; // canonical link to the paper
}

const ARXIV_NEW = /\b(\d{4}\.\d{4,5})(?:v\d+)?\b/;
const ARXIV_URL = /arxiv\.org\/(?:abs|pdf|html)\/((?:\d{4}\.\d{4,5})|(?:[a-z-]+(?:\.[A-Z]{2})?\/\d{7}))(?:v\d+)?/i;
const ARXIV_TEXT = /\barxiv[:\s]\s*(\d{4}\.\d{4,5})(?:v\d+)?\b/i;
const OPENREVIEW = /openreview\.net\/(?:forum|pdf)\?id=([A-Za-z0-9_-]+)/i;
const ACL = /aclanthology\.org\/([A-Z0-9][A-Za-z0-9.-]*\d)(?:\.pdf)?\/?(?=[\s"'<>)\]#?]|$)/;
const CVF = /(https?:\/\/openaccess\.thecvf\.com\/content[^\s"'<>)\]]+?\.(?:html|pdf))/i;
const IEEE = /ieeexplore\.ieee\.org\/(?:abstract\/)?document\/(\d+)/i;
const ACM_DOI = /dl\.acm\.org\/doi\/(?:abs\/|pdf\/|full\/|epdf\/)?(10\.\d{4,9}\/[^\s"'<>)\]?#]+)/i;

export function cleanDoi(raw: string): string {
  return raw.replace(/[.,;:]+$/, "").replace(/\.(pdf|html)$/i, "").toLowerCase();
}

/** A publisher DOI, or null for arXiv's own DOIs (10.48550/arXiv.…), which are not evidence of peer review. */
export function publisherDoi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const d = cleanDoi(raw);
  return d.startsWith("10.48550/") ? null : d;
}

export function arxivUrl(id: string): string {
  return `https://arxiv.org/abs/${id}`;
}

/** arXiv's own DOIs (10.48550/arXiv.2410.01234) are arXiv papers, not publisher DOIs. */
function doiToLink(doi: string): PaperLink {
  const d = cleanDoi(doi);
  const ax = d.match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})/);
  if (ax) return { kind: "arxiv", id: ax[1], url: arxivUrl(ax[1]) };
  return { kind: "doi", id: d, url: `https://doi.org/${d}` };
}

/** Classifies one URL as a paper link, or null if it is not one. */
export function classifyUrl(url: string): PaperLink | null {
  let m: RegExpMatchArray | null;
  if ((m = url.match(ARXIV_URL))) return { kind: "arxiv", id: m[1], url: arxivUrl(m[1]) };
  if ((m = url.match(OPENREVIEW))) return { kind: "openreview", id: m[1], url: `https://openreview.net/forum?id=${m[1]}` };
  if ((m = url.match(ACM_DOI))) return doiToLink(m[1]);
  if ((m = url.match(/doi\.org\/(10\.\d{4,9}\/[^\s"'<>)\]?#]+)/i))) return doiToLink(m[1]);
  if ((m = url.match(ACL))) return { kind: "acl", id: m[1], url: `https://aclanthology.org/${m[1]}/` };
  if ((m = url.match(CVF))) return { kind: "cvf", id: m[1].replace(/^http:/, "https:"), url: m[1].replace(/^http:/, "https:") };
  if ((m = url.match(IEEE))) return { kind: "ieee", id: m[1], url: `https://ieeexplore.ieee.org/document/${m[1]}` };
  return null;
}

/** All paper links in a block of text (markdown, HTML or plain), de-duplicated, in order of appearance. */
export function findPaperLinks(text: string, max = 12): PaperLink[] {
  const out: PaperLink[] = [];
  const seen = new Set<string>();
  const add = (l: PaperLink | null) => {
    if (!l) return;
    const k = `${l.kind}:${l.id}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(l);
  };
  // URLs first (most reliable), then bare "arXiv:2410.01234" and "doi: 10.x/y" mentions.
  for (const url of text.match(/https?:\/\/[^\s"'<>)\]]+/g) ?? []) add(classifyUrl(url));
  for (const m of text.matchAll(new RegExp(ARXIV_TEXT, "gi"))) add({ kind: "arxiv", id: m[1], url: arxivUrl(m[1]) });
  for (const m of text.matchAll(/\bdoi:\s*(10\.\d{4,9}\/[^\s"'<>)\]\}]+)/gi)) add(doiToLink(m[1]));
  return out.slice(0, max);
}

export function linkKey(l: PaperLink): string {
  return `${l.kind}:${l.id}`;
}

/** Strip arXiv version suffix: 2410.01234v2 → 2410.01234 */
export function bareArxivId(id: string): string {
  const m = id.match(ARXIV_NEW);
  return m ? m[1] : id.replace(/v\d+$/, "");
}

export function normalizeTitle(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** First GitHub / GitLab / Hugging Face repo link in text (arXiv comments and abstracts often have one). */
export function findCodeUrl(text: string): string | null {
  const m = text.match(/https?:\/\/(?:www\.)?(?:github\.com|gitlab\.com)\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/i);
  return m ? m[0].replace(/[.,;:]+$/, "") : null;
}
