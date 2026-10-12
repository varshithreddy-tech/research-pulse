// Hugging Face daily papers: community upvotes and code links for arXiv papers featured there.
import { utcDay } from "../time";

export interface HfPaperInfo {
  upvotes: number;
  code_url: string | null;
}

interface DailyEntry {
  paper?: { id?: string; upvotes?: number; githubRepo?: string | null; projectPage?: string | null };
}

/**
 * Upvotes for every paper featured on HF daily papers between `from` and `to`, keyed by arXiv ID.
 * Throws if Hugging Face is unreachable for every day (caller marks "not available").
 */
export async function hfDailyPapers(from: Date, to: Date): Promise<Map<string, HfPaperInfo>> {
  const out = new Map<string, HfPaperInfo>();
  let okDays = 0;
  let lastErr = "";
  for (let t = from.getTime(); t <= to.getTime() + 86_400_000; t += 86_400_000) {
    const day = utcDay(new Date(t));
    try {
      const res = await fetch(`https://huggingface.co/api/daily_papers?date=${day}&limit=100`, {
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`HF ${res.status}`);
      const list = (await res.json()) as DailyEntry[];
      okDays++;
      for (const e of list) {
        const id = e.paper?.id;
        if (!id) continue;
        const prev = out.get(id);
        const upvotes = e.paper?.upvotes ?? 0;
        if (!prev || upvotes > prev.upvotes) out.set(id, { upvotes, code_url: e.paper?.githubRepo ?? prev?.code_url ?? null });
      }
    } catch (e) {
      lastErr = String(e);
    }
  }
  if (okDays === 0) throw new Error(`Hugging Face unavailable: ${lastErr}`);
  return out;
}
