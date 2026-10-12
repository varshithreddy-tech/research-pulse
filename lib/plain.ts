// Plain English, no hype: the rule given to Gemini, plus a last safety net in code that removes
// hype words and intensifiers ("a critical risk" → "a risk") and fixes "a/an" afterwards.
// Label words ("validated", "breakthrough") go the same way — facts, not labels.
const HYPE = [
  "critical", "critically", "crucial", "crucially", "groundbreaking", "breakthrough", "validated", "revolutionary",
  "game-changing", "transformative", "unprecedented", "cutting-edge", "state-of-the-art", "remarkable", "remarkably",
  "deeply", "dramatically", "drastically", "vastly", "massively", "severely", "extremely", "incredibly", "seamlessly",
];

const HYPE_RE = new RegExp(`\\b(${HYPE.map((w) => w.replace(/-/g, "[-\\s]")).join("|")})\\b\\s*`, "gi");

export function dehype(s: string | null | undefined): string {
  if (!s) return "";
  return s
    .replace(HYPE_RE, "")
    .replace(/\b(an?|the)\s*,\s*/gi, "$1 ") // "a groundbreaking, validated result" → "a result"
    .replace(/,\s*,/g, ",")
    .replace(/\b([Aa])n ([b-df-hj-np-tv-z])/g, "$1 $2")
    .replace(/\b([Aa]) ([aeiou])/g, "$1n $2")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/^\s*([a-z])/, (m) => m.toUpperCase())
    .trim();
}

/** The writing rule for every reader-facing sentence (brief-format.md says the same). */
export const PLAIN_RULES = [
  "Write for a busy business consultant, not a researcher: everyday words, short sentences (about 20 words at most).",
  "No jargon. If a technical term is needed, explain it in brackets the first time, e.g. \"benchmark (a standard test)\",",
  "\"zero temperature (settings meant to give the same answer every time)\", \"open-vocabulary (any words, not a fixed list)\",",
  "\"edge device (runs on the gadget itself, not in the cloud)\", \"KV cache (the model's short-term memory of the prompt)\".",
  "Before answering, re-read each sentence: any word a business reader might not know must be explained in brackets or replaced.",
  "No hype words or intensifiers: never use critical, crucial, groundbreaking, breakthrough, validated, revolutionary,",
  "game-changing, unprecedented, cutting-edge, state-of-the-art, deeply, dramatically.",
].join("\n");
