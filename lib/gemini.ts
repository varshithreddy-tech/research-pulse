// The one place that talks to Gemini. Every call (success or failure) is logged to ai_usage
// with tokens and cost. Callers get { ok:false } instead of an exception, so a failed call
// can never drop a paper — the caller marks it "not assessed" and carries on.
import { q } from "./db";
import { env, envNumber, envOptional } from "./env";
import { sleep } from "./time";

export type Step = "clean" | "evidence" | "qualify" | "importance" | "rank" | "write";

export interface UsageCtx {
  runId?: number | null;
  briefId?: number | null;
}

export type GeminiResult<T> = { ok: true; data: T } | { ok: false; error: string };

interface CallOpts<T> {
  step: Step;
  system: string;
  user: string;
  schema: object;
  items: number;
  ctx: UsageCtx;
  /** Returns the parsed value, or null if the JSON does not have the expected shape. */
  validate: (o: unknown) => T | null;
  timeoutMs?: number;
}

export function geminiModel(): string {
  return env("GEMINI_MODEL");
}

export function costUsd(inputTokens: number, outputTokens: number): number {
  const pin = envNumber("GEMINI_PRICE_INPUT_PER_M", 0);
  const pout = envNumber("GEMINI_PRICE_OUTPUT_PER_M", 0);
  return (inputTokens * pin + outputTokens * pout) / 1_000_000;
}

async function logUsage(
  ctx: UsageCtx,
  step: Step,
  model: string,
  inTok: number,
  outTok: number,
  items: number,
  ok: boolean,
  error?: string,
): Promise<void> {
  try {
    await q(
      `INSERT INTO ai_usage (run_id, brief_id, step, model, input_tokens, output_tokens, cost_usd, items, ok, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [ctx.runId ?? null, ctx.briefId ?? null, step, model, inTok, outTok, costUsd(inTok, outTok), items, ok, error?.slice(0, 500) ?? null],
    );
  } catch {
    // Usage logging must never break the pipeline.
  }
}

interface RawResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  error?: { message?: string; details?: { "@type"?: string; retryDelay?: string }[] };
}

/**
 * JSON-mode Gemini call. Retries rate limits / server errors with backoff (up to 4 HTTP attempts)
 * and bad JSON once. Never throws.
 */
export async function geminiJson<T>(opts: CallOpts<T>): Promise<GeminiResult<T>> {
  const key = envOptional("GEMINI_API_KEY");
  const model = envOptional("GEMINI_MODEL");
  if (!key || !model) return { ok: false, error: "GEMINI_API_KEY or GEMINI_MODEL not set" };

  const thinkingLevel = envOptional("GEMINI_THINKING_LEVEL");
  const body = JSON.stringify({
    systemInstruction: { parts: [{ text: opts.system }] },
    contents: [{ role: "user", parts: [{ text: opts.user }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: opts.schema,
      temperature: 0.2,
      ...(thinkingLevel ? { thinkingConfig: { thinkingLevel } } : {}),
    },
  });

  let badJson = 0;
  let lastError = "unknown error";
  for (let attempt = 0; attempt < 4; attempt++) {
    let res: Response;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": key },
        body,
        signal: AbortSignal.timeout(opts.timeoutMs ?? 90_000),
      });
    } catch (e) {
      lastError = `network: ${String(e)}`;
      await logUsage(opts.ctx, opts.step, model, 0, 0, opts.items, false, lastError);
      await sleep(2000 * (attempt + 1));
      continue;
    }

    let json: RawResponse = {};
    try {
      json = (await res.json()) as RawResponse;
    } catch {
      // fall through with empty body
    }
    const u = json.usageMetadata ?? {};
    const inTok = u.promptTokenCount ?? 0;
    const outTok = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);

    if (!res.ok) {
      lastError = `Gemini ${res.status}: ${json.error?.message ?? res.statusText}`;
      await logUsage(opts.ctx, opts.step, model, inTok, outTok, opts.items, false, lastError);
      if (res.status === 429 || res.status >= 500) {
        const retry = json.error?.details?.find((d) => d.retryDelay)?.retryDelay;
        const waitS = retry ? Math.min(60, parseFloat(retry)) : 4 * 2 ** attempt;
        await sleep(waitS * 1000);
        continue;
      }
      return { ok: false, error: lastError }; // 4xx other than 429: retrying will not help
    }

    const text =
      json.candidates?.[0]?.content?.parts
        ?.filter((p) => !p.thought)
        .map((p) => p.text ?? "")
        .join("") ?? "";
    let parsed: T | null = null;
    try {
      parsed = opts.validate(JSON.parse(text));
    } catch {
      parsed = null;
    }
    if (parsed !== null) {
      await logUsage(opts.ctx, opts.step, model, inTok, outTok, opts.items, true);
      return { ok: true, data: parsed };
    }
    lastError = `bad JSON (finish: ${json.candidates?.[0]?.finishReason ?? "?"}): ${text.slice(0, 120)}`;
    await logUsage(opts.ctx, opts.step, model, inTok, outTok, opts.items, false, lastError);
    if (++badJson >= 2) break;
  }
  return { ok: false, error: lastError };
}

// Small schema helpers (Gemini's OpenAPI subset).
export const S = {
  str: (extra: object = {}) => ({ type: "STRING", ...extra }),
  int: () => ({ type: "INTEGER" }),
  bool: () => ({ type: "BOOLEAN" }),
  enumOf: (values: string[]) => ({ type: "STRING", enum: values }),
  arr: (items: object) => ({ type: "ARRAY", items }),
  obj: (properties: Record<string, object>, required = Object.keys(properties)) => ({
    type: "OBJECT",
    properties,
    required,
    propertyOrdering: Object.keys(properties),
  }),
};

export function isObj(o: unknown): o is Record<string, unknown> {
  return typeof o === "object" && o !== null && !Array.isArray(o);
}

/** Pulls `results` (an array of objects) out of a response, or null. */
export function resultsArray(o: unknown, key = "results"): Record<string, unknown>[] | null {
  if (!isObj(o) || !Array.isArray(o[key])) return null;
  return (o[key] as unknown[]).filter(isObj);
}
