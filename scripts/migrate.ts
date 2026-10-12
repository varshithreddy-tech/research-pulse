// Applies db/migrations/*.sql to Neon in order, once each. Usage: npm run db:migrate
import { config } from "dotenv";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local");
  process.exit(1);
}
const sql = neon(url);
const dir = path.join(process.cwd(), "db", "migrations");

async function main() {
  await sql.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())");
  const done = new Set((await sql.query("SELECT name FROM schema_migrations")).map((r) => r.name as string));
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    if (done.has(f)) {
      console.log(`skip  ${f}`);
      continue;
    }
    const statements = readFileSync(path.join(dir, f), "utf8")
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    for (const s of statements) await sql.query(s);
    await sql.query("INSERT INTO schema_migrations (name) VALUES ($1)", [f]);
    console.log(`apply ${f} (${statements.length} statements)`);
  }
  const tables = await sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1");
  console.log("tables:", tables.map((t) => t.table_name).join(", "));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
