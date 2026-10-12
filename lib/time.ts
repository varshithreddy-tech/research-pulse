// Time helpers. Kavita works in IST (UTC+5:30, no daylight saving).

const IST_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Monday 00:00 IST of the week containing `d`, as a UTC Date. */
export function istWeekStart(d: Date): Date {
  const ist = new Date(d.getTime() + IST_MS);
  const dow = (ist.getUTCDay() + 6) % 7; // Monday = 0
  const midnight = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - dow * DAY_MS;
  return new Date(midnight - IST_MS);
}

/** "6–12 Oct 2026" (IST dates, end inclusive). */
export function weekLabel(start: Date, end: Date): string {
  const s = new Date(start.getTime() + IST_MS);
  const e = new Date(end.getTime() + IST_MS - 1);
  const mon = (x: Date) => x.toLocaleString("en-GB", { month: "short", timeZone: "UTC" });
  if (s.getUTCMonth() === e.getUTCMonth() && s.getUTCFullYear() === e.getUTCFullYear())
    return `${s.getUTCDate()}–${e.getUTCDate()} ${mon(e)} ${e.getUTCFullYear()}`;
  return `${s.getUTCDate()} ${mon(s)} – ${e.getUTCDate()} ${mon(e)} ${e.getUTCFullYear()}`;
}

/** "12 Oct, 06:04" in IST. */
export function istShort(d: Date | string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleString("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** "2026-10-12" (UTC date) — used for Hugging Face daily papers. */
export function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** arXiv API date format YYYYMMDDHHMM (GMT). */
export function arxivDate(d: Date): string {
  return d.toISOString().replace(/[-:T]/g, "").slice(0, 12);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `fn` over items with at most `limit` in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
