// The dashboard is public, so the two run buttons are guarded — without blocking a normal visitor:
//   - never two runs of the same kind at once (a run in progress → show it instead of starting another)
//   - daily caps on button-started runs, reset at midnight IST: "Run daily now" 6, "Make brief now" 3
// No waiting period between runs. Scheduled (cron) runs and secret-protected API calls are not capped.
import { acquireLock, q, q1, releaseLock } from "./db";
import { istShort } from "./time";

export type RunKind = "daily" | "weekly";

export const DAILY_CAPS: Record<RunKind, number> = { daily: 6, weekly: 3 };

/** A run counts as "in progress" only while it keeps reporting (heartbeat); a crashed run never blocks. */
export const STALE_AFTER_MINUTES = 15;

export interface InProgress {
  runId: number;
  briefId: number | null;
  startedAt: string;
}

export type StartDecision =
  | { ok: true }
  | { ok: false; reason: "busy"; run: InProgress }
  | { ok: false; reason: "cap"; used: number; cap: number };

/** Pure rule: busy beats cap (so a visitor is pointed at the live run). */
export function decideStart(kind: RunKind, running: InProgress | null, usedToday: number): StartDecision {
  if (running) return { ok: false, reason: "busy", run: running };
  const cap = DAILY_CAPS[kind];
  if (usedToday >= cap) return { ok: false, reason: "cap", used: usedToday, cap };
  return { ok: true };
}

export function blockedMessage(kind: RunKind, d: Exclude<StartDecision, { ok: true }>): { msg: string; link: string | null } {
  if (d.reason === "busy") {
    const hhmm = istShort(d.run.startedAt).split(", ").pop();
    const link = kind === "daily" ? `/coverage#run-${d.run.runId}` : d.run.briefId ? `/?brief=${d.run.briefId}` : "/coverage";
    return { msg: `A run is already in progress — started at ${hhmm} IST.`, link };
  }
  return {
    msg:
      kind === "daily"
        ? "Daily limit reached — the scheduled run happens at 6:00 AM IST."
        : "Daily limit reached — the scheduled brief is made every Monday at 6:30 AM IST.",
    link: null,
  };
}

async function runningNow(kind: RunKind): Promise<InProgress | null> {
  return q1<InProgress>(
    `SELECT r.id AS "runId", b.id AS "briefId", r.started_at AS "startedAt"
     FROM runs r LEFT JOIN briefs b ON b.run_id = r.id
     WHERE r.kind = $1 AND r.status = 'running' AND r.heartbeat_at > now() - ($2 * interval '1 minute')
     ORDER BY r.id DESC LIMIT 1`,
    [kind, STALE_AFTER_MINUTES],
  );
}

async function buttonRunsToday(kind: RunKind): Promise<number> {
  const r = await q1<{ n: number }>(
    `SELECT count(*)::int AS n FROM runs
     WHERE kind = $1 AND trigger = 'dashboard'
       AND started_at >= (date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata')`,
    [kind],
  );
  return r?.n ?? 0;
}

/**
 * Checks the rules and, if allowed, calls `start` — all under a short lock so two clicks at the same
 * moment can't both start a run.
 */
export async function guardedStart<T>(kind: RunKind, start: () => Promise<T>): Promise<{ started: T } | { blocked: StartDecision & { ok: false } }> {
  const holder = `start:${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  const lock = `start:${kind}`;
  if (!(await acquireLock(lock, holder, 20))) {
    // Someone is starting one this very second: show that run (or, if not visible yet, say so).
    const run = (await runningNow(kind)) ?? { runId: 0, briefId: null, startedAt: new Date().toISOString() };
    return { blocked: { ok: false, reason: "busy", run } };
  }
  try {
    const d = decideStart(kind, await runningNow(kind), await buttonRunsToday(kind));
    if (!d.ok) return { blocked: d };
    return { started: await start() };
  } finally {
    await releaseLock(lock, holder);
  }
}

/** Gemini calls and cost per run, for Cost & coverage. */
export async function runCosts(runIds: number[]): Promise<Map<number, { calls: number; cost: number }>> {
  if (!runIds.length) return new Map();
  const rows = await q<{ run_id: number; calls: number; cost: string }>(
    `SELECT run_id, count(*)::int AS calls, COALESCE(sum(cost_usd), 0) AS cost FROM ai_usage WHERE run_id = ANY($1::int[]) GROUP BY run_id`,
    [runIds],
  );
  return new Map(rows.map((r) => [r.run_id, { calls: r.calls, cost: Number(r.cost) }]));
}
