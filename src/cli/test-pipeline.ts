import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { MemoryStore } from "../memory/vault-store.js";
import { processEpisode } from "../memory/process-episode.js";
import type { Episode } from "../memory/schema.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);
  const store = new MemoryStore(".agent-test-pipeline.db", ".agent-test-pipeline-vault");

  const scope = "repo:investment-bot";

  // Seed one existing memory the curator will need to reason about.
  const existing = await store.createMemory({
    type: "architecture",
    scope,
    content: "Uses Redis for caching.",
    sourceEpisode: null,
    confidence: 0.9,
  });
  console.log("Seeded existing memory:", existing.content);

  // A fabricated episode with two drafts: one that should trigger
  // UPDATE_SUPERSEDE (contradicts the Redis fact), one that should be a
  // clean CREATE (genuinely new, unrelated info).
  const episode: Episode = {
    id: "test-episode-1",
    sessionId: "test-session-1",
    summary: "Migrated caching to Valkey and added a new retry policy for the ingestion pipeline.",
    outcome: "success",
    createdAt: new Date().toISOString(),
    candidateMemories: [
      {
        content: "Cache backend has been migrated from Redis to Valkey.",
        suggestedType: "architecture",
        suggestedScope: scope,
      },
      {
        content: "The ingestion pipeline now retries failed SEC EDGAR fetches up to 3 times with exponential backoff.",
        suggestedType: "convention",
        suggestedScope: scope,
      },
    ],
  };

  const results = await processEpisode(provider, store, episode);

  console.log("\n--- Curator decisions ---");
  results.forEach((r, i) => {
    console.log(`${i + 1}. action=${r.decision.action} confidence=${r.decision.confidence}`);
    console.log(`   reason: ${r.decision.reason}`);
    console.log(`   memoryId: ${r.memoryId}`);
  });

  const supersedeDecision = results[0];
  const createDecision = results[1];

  const correctlySuperseded =
    supersedeDecision.decision.action === "UPDATE_SUPERSEDE" &&
    supersedeDecision.decision.oldMemoryId === existing.id;
  const correctlyCreated = createDecision.decision.action === "CREATE";

  console.log("\nCorrectly identified the supersede case:", correctlySuperseded);
  console.log("Correctly identified the new-fact case:", correctlyCreated);

  // Confirm the vault itself reflects this correctly, not just the decision object
  const activeNow = store.listMemories(scope, "active");
  console.log("\nActive memories in vault now:", activeNow.map((m) => m.content));
  const oldStillThereButSuperseded = store.getMemory(existing.id);
  console.log("Old Redis memory status:", oldStillThereButSuperseded?.status);

  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});