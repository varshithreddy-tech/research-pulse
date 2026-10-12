"use server";
// Dashboard actions. The dashboard is open to anyone with the link, so the two run buttons are
// guarded (one run of each kind at a time, daily caps) and every topic change is logged.
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { q, q1 } from "@/lib/db";
import { classifyUrl } from "@/lib/ids";
import { addPaperTopic, backfillTopic, savePlaceholderPaper } from "@/lib/papers";
import { launchDaily, launchWeekly } from "@/lib/pipeline/start";
import { blockedMessage, guardedStart } from "@/lib/runGuard";
import { logTopicChange, topicDiff, type TopicFields } from "@/lib/topicLog";

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

function withNotice(path: string, msg: string, link?: string | null): string {
  const sep = path.includes("?") ? "&" : "?";
  return `${path}${sep}msg=${encodeURIComponent(msg)}${link ? `&link=${encodeURIComponent(link)}` : ""}`;
}

// ---- Marks ----

/** Read fully / Share with a client / Not useful — each is an on/off toggle per paper. */
export async function toggleMark(paperId: number, kind: "read_fully" | "share" | "not_useful", briefItemId: number | null, topicId: number | null): Promise<void> {
  const removed = await q(`DELETE FROM marks WHERE paper_id = $1 AND kind = $2 RETURNING id`, [paperId, kind]);
  if (!removed.length)
    await q(`INSERT INTO marks (kind, paper_id, brief_item_id, topic_id) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`, [
      kind,
      paperId,
      briefItemId,
      topicId,
    ]);
  revalidatePath("/", "layout");
}

/** "You missed this": saved as a mark and counted. If the link is a real paper link, the paper also enters the pipeline. */
export async function addMissed(formData: FormData): Promise<void> {
  const url = String(formData.get("url") ?? "").trim();
  const topicId = Number(formData.get("topic_id")) || null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!/^https?:\/\//i.test(url)) redirect(withNotice("/", "Please paste the paper's full link (https://…)."));
  let paperId: number | null = null;
  const link = classifyUrl(url);
  if (link) {
    paperId = (await savePlaceholderPaper(link, url, "", "missed", null)).id;
    if (topicId) await addPaperTopic(paperId, topicId, "missed");
  }
  await q(`INSERT INTO marks (kind, paper_id, topic_id, missed_url, note) VALUES ('missed', $1, $2, $3, $4)`, [paperId, topicId, url, note]);
  revalidatePath("/", "layout");
  redirect(
    withNotice(
      "/",
      link
        ? "Thanks — saved. The paper will be confirmed and checked in the next run."
        : "Thanks — saved and counted. (This link isn't an arXiv / DOI / OpenReview / ACL / CVF / IEEE / ACM paper link, so it can't be checked automatically.)",
    ),
  );
}

// ---- Run buttons (public, guarded) ----

export async function runDailyNow(): Promise<void> {
  const o = await origin();
  const r = await guardedStart("daily", () => launchDaily("dashboard", o));
  if ("blocked" in r) {
    const { msg, link } = blockedMessage("daily", r.blocked);
    redirect(withNotice("/coverage", msg, link));
  }
  redirect(withNotice("/coverage", `Daily run #${r.started.runId} started. This page refreshes on its own.`, `/coverage#run-${r.started.runId}`));
}

export async function makeBriefNow(): Promise<void> {
  const o = await origin();
  const r = await guardedStart("weekly", () => launchWeekly("dashboard", o));
  if ("blocked" in r) {
    const { msg, link } = blockedMessage("weekly", r.blocked);
    redirect(withNotice("/", msg, link));
  }
  redirect(withNotice(`/?brief=${r.started.briefId}`, `Brief #${r.started.briefId} is being made. This page refreshes on its own.`));
}

// ---- Topics (every change is logged) ----

const CATEGORY = /^[a-z-]+(\.[A-Za-z-]+)?$/;

function splitList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveTopic(formData: FormData): Promise<void> {
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim().slice(0, 120);
  const focus = String(formData.get("focus") ?? "").trim().slice(0, 1000);
  const cats = splitList(formData.get("arxiv_categories")).flatMap((s) => s.split(/\s+/)).slice(0, 12);
  const words = splitList(formData.get("search_words")).slice(0, 20);
  const bad = cats.filter((c) => !CATEGORY.test(c));
  if (!name || !focus || !cats.length || bad.length) {
    const why = bad.length ? `Unknown category format: ${bad.join(", ")}` : "Name, focus and at least one arXiv category are needed.";
    redirect(withNotice("/topics", why));
  }
  const after: TopicFields = { name, focus, arxiv_categories: cats, search_words: words };
  let topicId = id;
  let catsChanged = true;
  if (id) {
    const before = await q1<TopicFields>(`SELECT name, focus, arxiv_categories, search_words FROM topics WHERE id = $1`, [id]);
    if (!before) redirect(withNotice("/topics", "That topic no longer exists."));
    const changes = topicDiff(before, after);
    catsChanged = JSON.stringify([...before.arxiv_categories].sort()) !== JSON.stringify([...cats].sort());
    if (!Object.keys(changes).length) redirect(withNotice("/topics", `No changes to “${name}”.`));
    await q(`UPDATE topics SET name = $2, focus = $3, arxiv_categories = $4, search_words = $5, updated_at = now() WHERE id = $1`, [
      id, name, focus, cats, words,
    ]);
    await logTopicChange(id, name, "edited", changes);
  } else {
    const r = await q1<{ id: number }>(
      `INSERT INTO topics (name, focus, arxiv_categories, search_words, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 1 FROM topics))
       ON CONFLICT (name) DO NOTHING RETURNING id`,
      [name, focus, cats, words],
    );
    if (!r) redirect(withNotice("/topics", `A topic called “${name}” already exists.`));
    topicId = r.id;
    await logTopicChange(r.id, name, "created", { name: { from: null, to: name }, focus: { from: null, to: focus }, arxiv_categories: { from: null, to: cats }, search_words: { from: null, to: words } });
  }
  // New topic or new categories: the last 7 days' papers in those categories are queued for this topic too.
  const queued = catsChanged && topicId ? await backfillTopic(topicId) : 0;
  revalidatePath("/", "layout");
  redirect(withNotice("/topics", `Saved “${name}”.${queued ? ` ${queued} recent papers queued for its relevance check.` : ""}`));
}

export async function setTopicActive(id: number, active: boolean): Promise<void> {
  const t = await q1<{ name: string; active: boolean }>(`UPDATE topics SET active = $2, updated_at = now() WHERE id = $1 RETURNING name, active`, [id, active]);
  if (t) await logTopicChange(id, t.name, active ? "resumed" : "paused", { active: { from: !active, to: active } });
  if (active) await backfillTopic(id);
  revalidatePath("/", "layout");
}

// ---- Client shortlist tags (free text, reusable) ----

export async function addShortlistTag(paperId: number, raw: string): Promise<void> {
  const { normalizeTag } = await import("@/lib/shortlist");
  const tag = normalizeTag(raw);
  if (!tag) return;
  // Reuse an existing tag's spelling when only the case differs.
  const same = await q1<{ tag: string }>(`SELECT tag FROM shortlist_tags WHERE lower(tag) = lower($1) LIMIT 1`, [tag]);
  await q(`INSERT INTO shortlist_tags (paper_id, tag) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [paperId, same?.tag ?? tag]);
  revalidatePath("/shortlist");
}

export async function removeShortlistTag(paperId: number, tag: string): Promise<void> {
  await q(`DELETE FROM shortlist_tags WHERE paper_id = $1 AND lower(tag) = lower($2)`, [paperId, tag]);
  revalidatePath("/shortlist");
}
