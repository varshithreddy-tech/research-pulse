import { login } from "../actions";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; next?: string }> }) {
  const sp = await searchParams;
  return (
    <main style={{ maxWidth: 360, paddingTop: 80 }}>
      <h1>Research Pulse</h1>
      <p className="muted small">Kavita&apos;s weekly research brief</p>
      <form action={login} className="card">
        <input type="hidden" name="next" value={sp.next ?? "/"} />
        <label htmlFor="pw">Password</label>
        <input id="pw" name="password" type="password" autoFocus required style={{ width: "100%" }} />
        {sp.error && <p className="small" style={{ color: "var(--bad)" }}>Wrong password.</p>}
        <p>
          <button className="primary">Log in</button>
        </p>
      </form>
    </main>
  );
}
