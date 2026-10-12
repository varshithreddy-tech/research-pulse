// Rebuilds ONLY the text of an existing brief (selection from the stored ranks, "What's changing",
// "What it's about", email + dashboard version). One Gemini call (write step); no scoring or ranking
// calls, and no email is sent. Usage: npm run brief:rebuild -- <briefId>
import { config } from "dotenv";

config({ path: ".env.local", quiet: true });

async function main() {
  const briefId = Number(process.argv[2]);
  if (!briefId) throw new Error("Usage: npm run brief:rebuild -- <briefId>");
  // Imported after dotenv so the modules see the env.
  const { activeTopics, q, q1 } = await import("../lib/db");
  const { appUrl } = await import("../lib/env");
  const { briefItems, briefLabel, buildDashboardBrief, renderEmail, windowCounts } = await import("../lib/brief");
  const { reselectFromStoredRanks } = await import("../lib/steps/rank");
  const { writeBrief } = await import("../lib/steps/write");

  const b = await q1<{ id: number; run_id: number | null; week_start: string; week_end: string }>(
    `SELECT id, run_id, week_start, week_end FROM briefs WHERE id = $1`,
    [briefId],
  );
  if (!b) throw new Error(`Brief ${briefId} not found`);
  const topics = await activeTopics();
  await reselectFromStoredRanks(b.id, topics);
  const counts = await windowCounts(b.week_start, b.week_end);
  const { sentences, by } = await writeBrief(b.id, topics, counts.topics, { runId: b.run_id, briefId: b.id });
  const items = await briefItems(b.id, true);
  const dash = buildDashboardBrief(briefLabel(b), counts, items, sentences);
  const email = renderEmail(b.id, dash, items, appUrl());
  await q(
    `UPDATE briefs SET per_topic = $2, whats_changing = $3, written_by = $4, email_subject = $5, email_html = $6, email_text = $7, dashboard_json = $8
     WHERE id = $1`,
    [b.id, JSON.stringify(Object.fromEntries(counts.topics.map((t) => [t.topic_id, t]))), JSON.stringify(sentences), by,
     email.subject, email.html, email.text, JSON.stringify(dash)],
  );
  console.log(`Rebuilt brief #${b.id} (written by ${by}): ${items.filter((i) => i.in_brief).length} papers in full, ${items.filter((i) => i.also_shown_in).length} "also relevant" lines. No email sent.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
