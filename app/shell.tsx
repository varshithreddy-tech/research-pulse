// Server wrapper for every page: loads the sidebar's data (topics + this week's picks) and renders the frame.
import { q, q1 } from "@/lib/db";
import type { DashboardBrief } from "@/lib/brief";
import { istWeekStart } from "@/lib/time";
import { Frame, type SideTopic } from "./frame";

export async function Shell({ children }: { children: React.ReactNode }) {
  const topics = await q<{ id: number; name: string }>(`SELECT id, name FROM topics WHERE active ORDER BY sort_order, id`);
  const brief = await q1<{ dashboard_json: DashboardBrief | null }>(
    `SELECT dashboard_json FROM briefs WHERE status = 'done' AND dashboard_json IS NOT NULL ORDER BY id DESC LIMIT 1`,
  );
  const shortlist = await q1<{ n: number }>(`SELECT count(*)::int AS n FROM marks WHERE kind = 'share'`);
  const counts = new Map((brief?.dashboard_json?.topics ?? []).map((t) => [t.topic_id, t.in_brief?.length ?? 0]));
  const side: SideTopic[] = topics.map((t) => ({ id: t.id, name: t.name, count: counts.get(t.id) ?? 0 }));
  // Next scheduled brief: next Monday 6:30 AM IST.
  const next = new Date(istWeekStart(new Date()).getTime() + 7 * 86_400_000 + 6.5 * 3_600_000);
  const nextBrief = next.toLocaleString("en-GB", { timeZone: "Asia/Kolkata", weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true });
  return (
    <Frame
      topics={side}
      week={brief?.dashboard_json?.label ?? null}
      nextBrief={nextBrief}
      shortlist={shortlist?.n ?? 0}
      papers={brief?.dashboard_json?.numbers?.scanned ?? brief?.dashboard_json?.topline?.papers_checked ?? null}
    >
      {children}
    </Frame>
  );
}
