// Rebuilds ONLY the text of an existing brief: the week (one definition: Mon–Sun IST), the picks and
// tiers from the stored ranks, the labs (Semantic Scholar), and ONE Gemini call (write step) for the
// summary, "What's changing", themes and each picked paper's text and client angle; then the
// dashboard and email versions. No scoring or ranking calls, and no email is sent.
// Usage: npm run brief:rebuild -- <briefId>
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const briefId = Number(process.argv[2]);
  if (!briefId) throw new Error("Usage: npm run brief:rebuild -- <briefId>");
  // Imported after dotenv so the modules see the env.
  const { activeTopics, q, q1 } = await import("../lib/db");
  const { appUrl } = await import("../lib/env");
  const { briefItems, briefLabel, buildDashboardBrief, olderSql, renderEmail, windowCounts } = await import("../lib/brief");
  const { numberProblems } = await import("../lib/numbers");
  const { reselectFromStoredRanks } = await import("../lib/steps/rank");
  const { refreshAffiliations } = await import("../lib/steps/reactions");
  const { writeBrief } = await import("../lib/steps/write");
  const { briefWeek } = await import("../lib/time");

  const b0 = await q1<{ id: number; run_id: number | null; created_at: string; trigger: string | null }>(
    `SELECT b.id, b.run_id, b.created_at, r.trigger FROM briefs b LEFT JOIN runs r ON r.id = b.run_id WHERE b.id = $1`,
    [briefId],
  );
  if (!b0) throw new Error(`Brief ${briefId} not found`);
  // The week this brief covers under the single definition (scheduled → week just ended; button → this week).
  const week = briefWeek(new Date(b0.created_at), b0.trigger === "cron");
  await q(`UPDATE briefs SET week_start = $2, week_end = $3 WHERE id = $1`, [b0.id, week.start.toISOString(), week.end.toISOString()]);
  // "Older" is relative to the week start, so refresh it for the new week.
  await q(
    `UPDATE brief_items bi SET older = ${olderSql("p", "$2")} FROM papers p WHERE p.id = bi.paper_id AND bi.brief_id = $1`,
    [b0.id, week.start.toISOString()],
  );
  const b = { ...b0, week_start: week.start.toISOString(), week_end: week.end.toISOString() };

  const topics = await activeTopics();
  await reselectFromStoredRanks(b.id, topics);
  let labs = { looked: 0, found: 0 };
  try {
    labs = await refreshAffiliations(b.id);
  } catch (e) {
    console.log(`Labs not refreshed (Semantic Scholar unavailable): ${String(e)}`);
  }
  const counts = await windowCounts(b.week_start, b.week_end);
  const before = await q1<{ cost: string }>(`SELECT COALESCE(sum(cost_usd), 0) AS cost FROM ai_usage WHERE brief_id = $1 AND step = 'write'`, [b.id]);
  const { sentences, by, summary, themes } = await writeBrief(b.id, topics, counts.topics, { runId: b.run_id, briefId: b.id });
  const after = await q1<{ cost: string }>(`SELECT COALESCE(sum(cost_usd), 0) AS cost FROM ai_usage WHERE brief_id = $1 AND step = 'write'`, [b.id]);
  const items = await briefItems(b.id, true);
  const dash = buildDashboardBrief(briefLabel(b), counts, items, sentences, { summary, themes });
  const email = renderEmail(b.id, dash, items, appUrl());
  await q(
    `UPDATE briefs SET papers_checked = $2, per_topic = $3, whats_changing = $4, written_by = $5, email_subject = $6, email_html = $7, email_text = $8,
       dashboard_json = $9 WHERE id = $1`,
    [b.id, counts.papers_checked, JSON.stringify(Object.fromEntries(counts.topics.map((t) => [t.topic_id, t]))), JSON.stringify(sentences), by,
     email.subject, email.html, email.text, JSON.stringify(dash)],
  );
  const tiers = [1, 2, 3].map((t) => items.filter((i) => i.tier === t).length);
  const problems = numberProblems(dash.numbers!);
  console.log(`Rebuilt brief #${b.id} for the week of ${dash.label} (written by ${by}). No email sent.`);
  console.log(`  ${dash.numbers!.scanned} scanned → ${dash.numbers!.on_topic} on her topics → ${dash.numbers!.picked} picked · tiers ${tiers.join(" / ")} · ~${dash.read_minutes} min read`);
  console.log(`  summary lines ${summary.length} · topics with themes ${Object.keys(themes).length} · labs found ${labs.found}/${labs.looked}`);
  console.log(`  write-step cost this rebuild: $${(Number(after?.cost ?? 0) - Number(before?.cost ?? 0)).toFixed(4)}`);
  console.log(`  numbers: ${problems.length ? `PROBLEMS: ${problems.join("; ")}` : "all consistent"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
