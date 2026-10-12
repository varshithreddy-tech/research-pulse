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

/**
 * "The week", used everywhere (brief, All papers, Cost & coverage): Monday 00:00 IST to the next
 * Monday 00:00 IST, 7 days, by when the system first found a paper.
 */
export function weekBounds(d: Date): { start: Date; end: Date } {
  const start = istWeekStart(d);
  return { start, end: new Date(start.getTime() + 7 * DAY_MS) };
}

/**
 * The week a brief covers: the scheduled Monday brief covers the week that just ended; a brief made
 * from the button (or the admin API) covers this week so far.
 */
export function briefWeek(now: Date, scheduled: boolean): { start: Date; end: Date } {
  const current = weekBounds(now);
  return scheduled ? weekBounds(new Date(current.start.getTime() - DAY_MS)) : current;
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
