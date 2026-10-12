// All Neon access goes through here. The browser never talks to Neon.
import { neon, type NeonQueryFunction } from "@neondatabase/serverless";
import { env } from "./env";

let client: NeonQueryFunction<false, false> | null = null;

function sql() {
  client ??= neon(env("DATABASE_URL"));
  return client;
}

/** Parameterised query. Returns rows. */
export async function q<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T[]> {
  return (await sql().query(text, params)) as T[];
}

export async function q1<T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows[0] ?? null;
}

// ---- Locks: stop a cron run and an admin click processing the same batch twice ----

export async function acquireLock(name: string, holder: string, ttlSeconds: number): Promise<boolean> {
  const r = await q(
    `INSERT INTO locks (name, holder, expires_at) VALUES ($1, $2, now() + $3 * interval '1 second')
     ON CONFLICT (name) DO UPDATE SET holder = EXCLUDED.holder, expires_at = EXCLUDED.expires_at
     WHERE locks.expires_at < now() OR locks.holder = EXCLUDED.holder
     RETURNING holder`,
    [name, holder, ttlSeconds],
  );
  return r.length > 0;
}

export async function releaseLock(name: string, holder: string): Promise<void> {
  await q("DELETE FROM locks WHERE name = $1 AND holder = $2", [name, holder]);
}

// ---- Shared row types ----

export interface Topic {
  id: number;
  name: string;
  focus: string;
  arxiv_categories: string[];
  search_words: string[];
  active: boolean;
  sort_order: number;
}

export async function activeTopics(): Promise<Topic[]> {
  return q<Topic>("SELECT * FROM topics WHERE active ORDER BY sort_order, id");
}

export async function allTopics(): Promise<Topic[]> {
  return q<Topic>("SELECT * FROM topics ORDER BY active DESC, sort_order, id");
}

export async function appendRunError(runId: number, where: string, message: string): Promise<void> {
  await q(`UPDATE runs SET errors = errors || $2::jsonb, heartbeat_at = now() WHERE id = $1`, [
    runId,
    JSON.stringify([{ at: new Date().toISOString(), where, message: message.slice(0, 500) }]),
  ]);
}
