import { rmSync } from "node:fs";
import { MemoryStore } from "../memory/vault-store.js";
import { retrieveMemories } from "../memory/retrieval.js";

const DB_PATH = ".agent-test-retrieval.db";
const VAULT_PATH = ".agent-test-retrieval-vault";

// Clean slate every run — without this, re-running the script keeps
// appending to the same SQLite file and duplicate seed data piles up.
// (Exactly what happened last run: every memory showed up 2x, 3x, 4x —
// not a retrieval bug, a missing test-cleanup bug.)
for (const path of [DB_PATH, `${DB_PATH}-wal`, `${DB_PATH}-shm`]) {
  rmSync(path, { force: true });
}
rmSync(VAULT_PATH, { recursive: true, force: true });

async function main() {
  const store = new MemoryStore(DB_PATH, VAULT_PATH);
  const scope = "repo:investment-bot";

  const redis = await store.createMemory({
    type: "architecture",
    scope,
    content: "Uses Redis for caching.",
    sourceEpisode: null,
    confidence: 0.9,
  });

  await store.createMemory({
    type: "architecture",
    scope,
    content: "Migrated cache backend to Valkey.",
    sourceEpisode: null,
    confidence: 0.95,
    supersedes: redis.id,
  });

  await store.createMemory({
    type: "architecture",
    scope,
    content: "Uses LangGraph for multi-agent orchestration.",
    sourceEpisode: null,
    confidence: 0.9,
  });

  await store.createMemory({
    type: "gotcha",
    scope,
    content: "SEC EDGAR API returns 429 errors without explicit rate limiting between requests.",
    sourceEpisode: null,
    confidence: 0.92,
  });

  const cachingResults = retrieveMemories(store, { scope, query: "what caching layer do we use" });
  console.log("Query: 'what caching layer do we use'");
  cachingResults.forEach((m) => console.log(`  - ${m.content}`));

  const surfacesValkey = cachingResults.some((m) => m.content.includes("Valkey"));
  const excludesRedis = !cachingResults.some((m) => m.content.includes("Redis"));
  console.log(`PASS (surfaces Valkey, excludes superseded Redis): ${surfacesValkey && excludesRedis}`);

  const rateLimitResults = retrieveMemories(store, { scope, query: "rate limiting SEC EDGAR errors" });
  console.log("\nQuery: 'rate limiting SEC EDGAR errors'");
  rateLimitResults.forEach((m) => console.log(`  - ${m.content}`));

  const topResultIsRateLimit = rateLimitResults[0]?.content.includes("429");
  console.log(`PASS (top result is the rate-limit gotcha): ${topResultIsRateLimit}`);

  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});