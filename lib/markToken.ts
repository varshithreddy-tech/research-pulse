// Signed one-click feedback links for the email. A token names ONE brief item and ONE mark type,
// expires after 14 days, and is signed with CRON_SECRET (HMAC-SHA256), so it can't be forged or
// changed into a different mark. No login needed — the token is the permission.
import { createHmac, timingSafeEqual } from "node:crypto";

export const MARK_KINDS = ["read_fully", "share", "not_useful"] as const;
export type MarkKind = (typeof MARK_KINDS)[number];

export const MARK_LABEL: Record<MarkKind, string> = {
  read_fully: "Read fully",
  share: "Share with a client",
  not_useful: "Not useful",
};

export const TOKEN_TTL_MS = 14 * 86_400_000;

function sign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(`mark:${body}`).digest("base64url");
}

export function makeMarkToken(itemId: number, kind: MarkKind, now = Date.now(), secret = process.env.CRON_SECRET ?? ""): string {
  if (!secret) throw new Error("Missing env var CRON_SECRET");
  const body = `${itemId}.${kind}.${Math.floor((now + TOKEN_TTL_MS) / 1000)}`;
  return `${body}.${sign(body, secret)}`;
}

export type TokenCheck = { ok: true; itemId: number; kind: MarkKind } | { ok: false; reason: "invalid" | "expired" };

export function verifyMarkToken(token: string, now = Date.now(), secret = process.env.CRON_SECRET ?? ""): TokenCheck {
  const m = /^(\d+)\.(read_fully|share|not_useful)\.(\d+)\.([A-Za-z0-9_-]+)$/.exec(token ?? "");
  if (!m || !secret) return { ok: false, reason: "invalid" };
  const body = `${m[1]}.${m[2]}.${m[3]}`;
  const want = Buffer.from(sign(body, secret));
  const got = Buffer.from(m[4]);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return { ok: false, reason: "invalid" };
  if (Number(m[3]) * 1000 < now) return { ok: false, reason: "expired" };
  return { ok: true, itemId: Number(m[1]), kind: m[2] as MarkKind };
}
