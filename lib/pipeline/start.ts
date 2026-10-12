// Entry points shared by the cron routes, the admin API routes and the dashboard buttons.
// Each returns at once; the work runs in the background via `after()` (bounded by maxDuration).
import { after } from "next/server";
import { appUrl } from "../env";
import { createRun } from "./common";
import { dailyInvocation } from "./daily";
import { startWeekly, weeklyInvocation } from "./weekly";

export async function launchDaily(trigger: "cron" | "admin", origin: string, cont?: { runId: number; hop: number }): Promise<{ runId: number; hop: number }> {
  const runId = cont?.runId ?? (await createRun("daily", trigger));
  const hop = cont?.hop ?? 0;
  after(() => dailyInvocation(runId, hop, appUrl(origin)));
  return { runId, hop };
}

export async function launchWeekly(
  trigger: "cron" | "admin",
  origin: string,
  cont?: { runId: number; briefId: number; hop: number },
): Promise<{ runId: number; briefId: number; hop: number }> {
  const ids = cont ?? { ...(await startWeekly(trigger)), hop: 0 };
  after(() => weeklyInvocation(ids.runId, ids.briefId, ids.hop, appUrl(origin)));
  return ids;
}
