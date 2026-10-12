"use server";
// Dashboard actions. Every one re-checks the session (the proxy is the first lock, this is the second).
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, isValidSession, safeEqual, sessionToken } from "@/lib/auth";
import { q, q1 } from "@/lib/db";
import { classifyUrl } from "@/lib/ids";
import { addPaperTopic, backfillTopic, savePlaceholderPaper } from "@/lib/papers";
import { launchDaily, launchWeekly } from "@/lib/pipeline/start";

async function requireSession(): Promise<void> {
  const jar = await cookies();
  if (!(await isValidSession(jar.get(SESSION_COOKIE)?.value))) redirect("/login");
}

async function origin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

// ---- Login ----

export async function login(formData: FormData): Promise<void> {
  const pw = String(formData.get("password") ?? "");
  const next = String(formData.get("next") ?? "/");
  const expected = process.env.DASHBOARD_PASSWORD ?? "";
  if (!expected || !safeEqual(pw, expected)) redirect(`/login?error=1&next=${encodeURIComponent(next)}`);
  (await cookies()).set(SESSION_COOKIE, await sessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// ---- Marks ----

/** Read fully / Share with a client / Not useful — each is an on/off toggle per paper. */
export async function toggleMark(paperId: number, kind: "read_fully" | "share" | "not_useful", briefItemId: number | null, topicId: number | null): Promise<void> {
  await requireSession();
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
  await requireSession();
  const url = String(formData.get("url") ?? "").trim();
  const topicId = Number(formData.get("topic_id")) || null;
  const note = String(formData.get("note") ?? "").trim().slice(0, 500) || null;
  if (!/^https?:\/\//i.test(url)) redirect("/?msg=" + encodeURIComponent("Please paste the paper's full link (https://…)."));
  let paperId: number | null = null;
  const link = classifyUrl(url);
  if (link) {
    paperId = (await savePlaceholderPaper(link, url, "", "missed", null)).id;
    if (topicId) await addPaperTopic(paperId, topicId, "missed");
  }
  await q(`INSERT INTO marks (kind, paper_id, topic_id, missed_url, note) VALUES ('missed', $1, $2, $3, $4)`, [paperId, topicId, url, note]);
  revalidatePath("/", "layout");
  redirect(
    "/?msg=" +
      encodeURIComponent(
        link
          ? "Thanks — saved. The paper will be confirmed and checked in the next run."
          : "Thanks — saved and counted. (This link isn't an arXiv / DOI / OpenReview / ACL / CVF / IEEE / ACM paper link, so it can't be checked automatically.)",
      ),
  );
}

// ---- Admin buttons ----

export async function runDailyNow(): Promise<void> {
  await requireSession();
  const { runId } = await launchDaily("admin", await origin());
  redirect(`/coverage?msg=${encodeURIComponent(`Daily run #${runId} started. Refresh this page to follow it.`)}`);
}

export async function makeBriefNow(): Promise<void> {
  await requireSession();
  const { briefId } = await launchWeekly("admin", await origin());
  redirect(`/?brief=${briefId}&msg=${encodeURIComponent(`Brief #${briefId} is being made. This page refreshes on its own.`)}`);
}

// ---- Topics ----

const CATEGORY = /^[a-z-]+(\.[A-Za-z-]+)?$/;

function splitList(raw: FormDataEntryValue | null): string[] {
  return String(raw ?? "")
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function saveTopic(formData: FormData): Promise<void> {
  await requireSession();
  const id = Number(formData.get("id")) || null;
  const name = String(formData.get("name") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();
  const cats = splitList(formData.get("arxiv_categories")).flatMap((s) => s.split(/\s+/));
  const words = splitList(formData.get("search_words"));
  const bad = cats.filter((c) => !CATEGORY.test(c));
  if (!name || !focus || !cats.length || bad.length) {
    const why = bad.length ? `Unknown category format: ${bad.join(", ")}` : "Name, focus and at least one arXiv category are needed.";
    redirect(`/topics?msg=${encodeURIComponent(why)}`);
  }
  let topicId = id;
  let catsChanged = true;
  if (id) {
    const before = await q1<{ arxiv_categories: string[] }>(`SELECT arxiv_categories FROM topics WHERE id = $1`, [id]);
    catsChanged = JSON.stringify([...(before?.arxiv_categories ?? [])].sort()) !== JSON.stringify([...cats].sort());
    await q(`UPDATE topics SET name = $2, focus = $3, arxiv_categories = $4, search_words = $5, updated_at = now() WHERE id = $1`, [
      id, name, focus, cats, words,
    ]);
  } else {
    const r = await q1<{ id: number }>(
      `INSERT INTO topics (name, focus, arxiv_categories, search_words, sort_order)
       VALUES ($1, $2, $3, $4, (SELECT COALESCE(max(sort_order), 0) + 1 FROM topics)) RETURNING id`,
      [name, focus, cats, words],
    );
    topicId = r!.id;
  }
  // New topic or new categories: the last 7 days' papers in those categories are queued for this topic too.
  const queued = catsChanged && topicId ? await backfillTopic(topicId) : 0;
  revalidatePath("/", "layout");
  redirect(`/topics?msg=${encodeURIComponent(`Saved “${name}”.${queued ? ` ${queued} recent papers queued for its relevance check.` : ""}`)}`);
}

export async function setTopicActive(id: number, active: boolean): Promise<void> {
  await requireSession();
  await q(`UPDATE topics SET active = $2, updated_at = now() WHERE id = $1`, [id, active]);
  if (active) await backfillTopic(id);
  revalidatePath("/", "layout");
}
