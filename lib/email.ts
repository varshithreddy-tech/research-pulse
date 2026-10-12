// Resend: the system only ever emails Kavita (KAVITA_EMAIL). Nothing goes to clients.
import { envOptional } from "./env";

export async function sendToKavita(subject: string, html: string, text: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const key = envOptional("RESEND_API_KEY");
  const to = envOptional("KAVITA_EMAIL");
  if (!key || !to) return { ok: false, error: "RESEND_API_KEY or KAVITA_EMAIL not set" };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ from: "Research Pulse <onboarding@resend.dev>", to: [to], subject, html, text }),
      signal: AbortSignal.timeout(30_000),
    });
    const json = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) return { ok: false, error: `Resend ${res.status}: ${json.message ?? ""}` };
    return { ok: true, id: json.id ?? "" };
  } catch (e) {
    return { ok: false, error: `Resend network: ${String(e)}` };
  }
}
