// Works through a queue of pending items in parallel Gemini batches until the queue is empty or
// time runs out. Every handler must move each item on (assessed / not_assessed / attempts+1),
// so the queue always shrinks.
import { envNumber } from "../env";
import { chunk } from "../time";

export interface DrainResult {
  handled: number;
  more: boolean; // true = stopped for time, items still waiting
}

export async function drain<T>(opts: {
  load: (limit: number) => Promise<T[]>;
  batchSize: number;
  deadline: number;
  handle: (batch: T[]) => Promise<void>;
  reserveMs?: number; // stop starting new batches this long before the deadline
}): Promise<DrainResult> {
  const conc = Math.max(1, envNumber("GEMINI_CONCURRENCY", 3));
  const reserve = opts.reserveMs ?? 45_000;
  let handled = 0;
  for (;;) {
    if (Date.now() > opts.deadline - reserve) return { handled, more: (await opts.load(1)).length > 0 };
    const items = await opts.load(opts.batchSize * conc);
    if (!items.length) return { handled, more: false };
    await Promise.all(chunk(items, opts.batchSize).map((b) => opts.handle(b)));
    handled += items.length;
  }
}
