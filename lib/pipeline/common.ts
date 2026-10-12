// Shared pipeline plumbing: run rows, the single "pipeline" lock, self-chaining for long runs,
// and the processing queue (confirm → clean → evidence → qualify) used by both daily and weekly runs.
import { acquireLock, appendRunError, q, q1, releaseLock, type Topic } from "../db";
import { env } from "../env";
import type { UsageCtx } from "../gemini";
import { sleep } from "../time";
import { cleanPending } from "../steps/clean";
import { confirmPending } from "../steps/confirm";
import { evidencePending } from "../steps/evidence";
import { qualifyPending } from "../steps/qualify";

/** Work budget per invocation. Vercel's limit is 300 s; keep headroom for saving and chaining. */
export const BUDGET_MS = 250_000;
export const MAX_HOPS = 12;
const LOCK = "pipeline";

/** cron = Vercel Cron · admin = API call with CRON_SECRET · dashboard = public button (guarded, capped). */
export type Trigger = "cron" | "admin" | "dashboard";

export async function createRun(kind: "daily" | "weekly", trigger: Trigger): Promise<number> {
  const r = await q1<{ id: number }>(`INSERT INTO runs (kind, trigger) VALUES ($1, $2) RETURNING id`, [kind, trigger]);
  return r!.id;
}

export async function heartbeat(runId: number, hop: number): Promise<void> {
  await q(`UPDATE runs SET heartbeat_at = now(), hops = GREATEST(hops, $2) WHERE id = $1`, [runId, hop]);
}

export async function finishRun(runId: number, status: "done" | "partial" | "failed"): Promise<void> {
  await q(`UPDATE runs SET status = $2, finished_at = now(), heartbeat_at = now() WHERE id = $1`, [runId, status]);
}

/** Waits (up to `waitMs`) for the pipeline lock. Daily and weekly share it so they never race. */
export async function lockOrWait(holder: string, waitMs: number): Promise<boolean> {
  const until = Date.now() + waitMs;
  for (;;) {
    if (await acquireLock(LOCK, holder, 320)) return true;
    if (Date.now() > until) return false;
    await sleep(10_000);
  }
}

export const unlock = (holder: string) => releaseLock(LOCK, holder);

/** Starts the next invocation of a long run. The target route answers 202 at once and works in the background. */
export async function chainNext(origin: string, path: string, params: Record<string, string | number>): Promise<boolean> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  try {
    const res = await fetch(`${origin}${path}?${qs}`, {
      headers: { authorization: `Bearer ${env("CRON_SECRET")}` },
      signal: AbortSignal.timeout(20_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface PendingCounts {
  confirm: number;
  clean: number;
  blogs: number;
  qualify: number;
}

export async function pendingCounts(): Promise<PendingCounts> {
  const r = await q1<PendingCounts>(
    `SELECT
       (SELECT count(*) FROM papers WHERE confirm_status = 'pending')::int AS confirm,
       (SELECT count(*) FROM papers WHERE clean_status = 'pending' AND confirm_status = 'confirmed')::int AS clean,
       (SELECT count(*) FROM blogs WHERE evidence_status = 'pending')::int AS blogs,
       (SELECT count(*) FROM paper_topics pt JOIN topics t ON t.id = pt.topic_id AND t.active
          JOIN papers p ON p.id = pt.paper_id AND p.confirm_status = 'confirmed'
        WHERE pt.status = 'pending')::int AS qualify`,
  );
  return r!;
}

export function nothingPending(c: PendingCounts): boolean {
  return c.confirm + c.clean + c.blogs + c.qualify === 0;
}

/**
 * Daily 3–5 on everything waiting: confirm papers, clean records, check blogs, qualifying check.
 * Stops starting new work near the deadline; whatever is left stays "pending" for the next invocation.
 */
export async function processQueue(topics: Topic[], ctx: UsageCtx, deadline: number): Promise<PendingCounts> {
  const runId = ctx.runId ?? null;
  const guard = async (where: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
    } catch (e) {
      if (runId) await appendRunError(runId, where, String(e));
    }
  };
  if (runId && (!process.env.GEMINI_API_KEY || !process.env.GEMINI_MODEL))
    await appendRunError(runId, "gemini", "GEMINI_API_KEY / GEMINI_MODEL not set — papers are kept and marked “not assessed”.");
  // Confirming is capped at 60 s per invocation so a slow Semantic Scholar never holds up the Gemini steps.
  const confirmAll = async () => {
    const until = Math.min(deadline - 60_000, Date.now() + 60_000);
    while (Date.now() < until && (await confirmPending(20, until)) > 0);
  };
  await guard("confirm", confirmAll);
  await guard("clean", () => cleanPending(topics, ctx, deadline));
  await guard("evidence", () => evidencePending(topics, ctx, deadline));
  await guard("confirm", confirmAll); // papers the blogs pointed to
  await guard("clean", () => cleanPending(topics, ctx, deadline));
  await guard("qualify", () => qualifyPending(topics, ctx, deadline));
  return pendingCounts();
}
