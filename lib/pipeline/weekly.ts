// MONDAY RUN (6:30 AM IST). Finish any waiting checks → snapshot this week's papers → reaction
// numbers → Question 2 → rank → write → save → email Kavita. Resumable: the brief row's status says
// which step is next, so a continuation picks up exactly where the last invocation stopped.
import { activeTopics, appendRunError, q, q1 } from "../db";
import { sendToKavita } from "../email";
import { briefItems, briefLabel, buildDashboardBrief, olderSql, renderEmail, windowCounts } from "../brief";
import { gatherReactions } from "../steps/reactions";
import { scoreBrief } from "../steps/importance";
import { rankBrief } from "../steps/rank";
import { writeBrief } from "../steps/write";
import {
  BUDGET_MS, MAX_HOPS, chainNext, createRun, finishRun, heartbeat, lockOrWait, nothingPending, pendingCounts, processQueue, unlock,
  type Trigger,
} from "./common";

/** Hops spent finishing the daily checks before the brief goes ahead with what is ready. */
const MAX_WAIT_HOPS = 3;

export async function startWeekly(trigger: Trigger): Promise<{ runId: number; briefId: number }> {
  const runId = await createRun("weekly", trigger);
  const r = await q1<{ id: number }>(
    `INSERT INTO briefs (run_id, week_start, week_end) VALUES ($1, now() - interval '7 days', now()) RETURNING id`,
    [runId],
  );
  return { runId, briefId: r!.id };
}

interface BriefState {
  id: number;
  status: string;
  week_start: string;
  week_end: string;
}

async function setStatus(briefId: number, status: string): Promise<void> {
  await q(`UPDATE briefs SET status = $2 WHERE id = $1`, [briefId, status]);
}

/** Monday 1 — every relevant paper of the week (plus those whose relevance could not be assessed). */
async function snapshot(b: BriefState): Promise<void> {
  await q(
    `INSERT INTO brief_items (brief_id, paper_id, topic_id, relevance, importance_status, older, published_year)
     SELECT $1, pt.paper_id, pt.topic_id,
            CASE WHEN pt.status = 'assessed' THEN 'yes' ELSE 'not_assessed' END,
            CASE WHEN pt.status = 'assessed' THEN 'pending' ELSE 'skipped' END,
            ${olderSql("p", "$2")}, EXTRACT(YEAR FROM p.published_at)::int
     FROM paper_topics pt
     JOIN papers p ON p.id = pt.paper_id
     JOIN topics t ON t.id = pt.topic_id AND t.active
     WHERE p.first_seen_at >= $2 AND p.first_seen_at < $3
       AND p.confirm_status = 'confirmed' AND p.is_research_paper
       AND ((pt.status = 'assessed' AND pt.relevant) OR pt.status = 'not_assessed')
     ON CONFLICT DO NOTHING`,
    [b.id, b.week_start, b.week_end],
  );
}

async function weekCost(b: BriefState): Promise<{ calls: number; cost: number }> {
  const r = await q1<{ calls: number; cost: string }>(
    `SELECT count(*)::int AS calls, COALESCE(sum(cost_usd), 0) AS cost FROM ai_usage WHERE created_at >= $1 OR brief_id = $2`,
    [b.week_start, b.id],
  );
  return { calls: r?.calls ?? 0, cost: Number(r?.cost ?? 0) };
}

export async function weeklyInvocation(runId: number, briefId: number, hop: number, origin: string): Promise<void> {
  const started = Date.now();
  const holder = `weekly:${runId}:${hop}`;
  if (!(await lockOrWait(holder, 150_000))) {
    if (hop < MAX_HOPS && (await chainNext(origin, "/api/weekly", { run: runId, brief: briefId, hop: hop + 1 }))) return;
    await appendRunError(runId, "lock", "Pipeline stayed busy; press “Make brief now” to retry.");
    await setStatus(briefId, "failed");
    await finishRun(runId, "failed");
    return;
  }
  const deadline = started + BUDGET_MS;
  const ctx = { runId, briefId };
  let chained = false;
  const next = async () => {
    await unlock(holder);
    chained = await chainNext(origin, "/api/weekly", { run: runId, brief: briefId, hop: hop + 1 });
    if (!chained) {
      await appendRunError(runId, "chain", "Could not start the next step; press “Make brief now” to retry.");
      await finishRun(runId, "partial");
    }
  };

  try {
    await heartbeat(runId, hop);
    const topics = await activeTopics();
    for (;;) {
      const b = (await q1<BriefState>(`SELECT id, status, week_start, week_end FROM briefs WHERE id = $1`, [briefId]))!;
      if (Date.now() > deadline - 20_000 && b.status !== "done") {
        if (hop < MAX_HOPS) return await next();
        await finishRun(runId, "partial");
        return;
      }

      if (b.status === "collecting") {
        // Finish the week's daily checks first, so nothing found this week misses the brief.
        const before = await pendingCounts();
        const left = await processQueue(topics, ctx, deadline);
        // Keep waiting only while the checks are moving; papers stuck on a busy source are shown as waiting.
        const moved = JSON.stringify(before) !== JSON.stringify(left);
        if (!nothingPending(left) && moved && hop < MAX_WAIT_HOPS) return await next();
        if (Date.now() > deadline - 70_000) return await next(); // leave reaction lookups a full invocation
        await snapshot(b);
        await gatherReactions(b.id, new Date(b.week_start), new Date(b.week_end), runId);
        await setStatus(b.id, "scoring");
      } else if (b.status === "scoring") {
        const r = await scoreBrief(b.id, topics, ctx, deadline);
        if (r.more) {
          if (hop < MAX_HOPS) return await next();
          // Out of hops: the rest are kept and shown as "not assessed".
          await q(`UPDATE brief_items SET importance_status = 'not_assessed' WHERE brief_id = $1 AND importance_status = 'pending'`, [b.id]);
        }
        await setStatus(b.id, "ranking");
      } else if (b.status === "ranking") {
        const ranked = await rankBrief(b.id, topics, ctx);
        await q(`UPDATE briefs SET papers_ranked = $2, status = 'writing' WHERE id = $1`, [b.id, ranked]);
      } else if (b.status === "writing") {
        const counts = await windowCounts(b.week_start, b.week_end);
        const { sentences, by } = await writeBrief(b.id, topics, counts.topics, ctx);
        const items = await briefItems(b.id, true);
        const label = briefLabel(b);
        const dash = buildDashboardBrief(label, counts, items, sentences);
        const email = renderEmail(b.id, dash, items, origin);
        const cost = await weekCost(b);
        await q(
          `UPDATE briefs SET status = 'sending', papers_checked = $2, per_topic = $3, whats_changing = $4, written_by = $5,
             email_subject = $6, email_html = $7, email_text = $8, dashboard_json = $9, gemini_calls = $10, gemini_cost_usd = $11
           WHERE id = $1`,
          [b.id, counts.papers_checked, JSON.stringify(Object.fromEntries(counts.topics.map((t) => [t.topic_id, t]))),
           JSON.stringify(sentences), by, email.subject, email.html, email.text, JSON.stringify(dash), cost.calls, cost.cost],
        );
      } else if (b.status === "sending") {
        const e = await q1<{ email_subject: string; email_html: string; email_text: string }>(
          `SELECT email_subject, email_html, email_text FROM briefs WHERE id = $1`,
          [b.id],
        );
        const sent = await sendToKavita(e!.email_subject, e!.email_html, e!.email_text);
        await q(
          `UPDATE briefs SET status = 'done', finished_at = now(), sent_at = CASE WHEN $2 THEN now() END, email_status = $3, email_id = $4
           WHERE id = $1`,
          [b.id, sent.ok, sent.ok ? "sent" : `failed: ${sent.error}`, sent.ok ? sent.id : null],
        );
        if (!sent.ok) await appendRunError(runId, "email", sent.error);
      } else {
        await finishRun(runId, b.status === "done" ? "done" : "failed");
        return;
      }
    }
  } catch (e) {
    await appendRunError(runId, "weekly", String(e));
    await setStatus(briefId, "failed");
    await finishRun(runId, "failed");
  } finally {
    if (!chained) await unlock(holder);
  }
}
