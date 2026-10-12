// Loads context/topics.json into the topics table. Existing topics (same name) are left alone,
// so Kavita's dashboard edits are never overwritten. Usage: npm run db:seed
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

config({ path: ".env.local" });

interface SeedTopic {
  name: string;
  focus: string;
  arxiv_categories: string[];
  search_words: string[];
  active: boolean;
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("Set DATABASE_URL in .env.local");
  process.exit(1);
}
const sql = neon(url);

async function main() {
  const { topics } = JSON.parse(readFileSync("context/topics.json", "utf8")) as { topics: SeedTopic[] };
  let added = 0;
  for (const [i, t] of topics.entries()) {
    const r = await sql.query(
      `INSERT INTO topics (name, focus, arxiv_categories, search_words, active, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (name) DO NOTHING RETURNING id`,
      [t.name, t.focus, t.arxiv_categories, t.search_words, t.active, i + 1],
    );
    if (r.length) added++;
  }
  console.log(`Seeded ${added} new topic(s); ${topics.length - added} already existed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
