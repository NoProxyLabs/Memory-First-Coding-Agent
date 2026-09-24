import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { MemoryStore } from "../memory/vault-store.js";

async function main() {
  const vaultDir = ".agent-test-vault";
  const store = new MemoryStore(".agent-test-memories.db", vaultDir);

  const scope = "repo:investment-bot";

  const redis = await store.createMemory({
    type: "architecture",
    scope,
    content: "Uses Redis for caching.",
    sourceEpisode: null,
    confidence: 0.9,
  });
  console.log("Created:", redis.id, "-", redis.content);

  const beforeActive = store.listMemories(scope, "active");
  console.log("Active before supersede:", beforeActive.map((m) => m.content));

  const valkey = await store.createMemory({
    type: "architecture",
    scope,
    content: "Migrated cache backend to Valkey.",
    sourceEpisode: null,
    confidence: 0.95,
    supersedes: redis.id,
  });
  console.log("Created:", valkey.id, "-", valkey.content, "(supersedes", redis.id + ")");

  const afterActive = store.listMemories(scope, "active");
  const oldRecord = store.getMemory(redis.id);

  console.log("\nActive after supersede:", afterActive.map((m) => m.content));
  console.log("Old record status:", oldRecord?.status, "| valid_until set:", oldRecord?.validUntil !== null);

  const temporalCorrect =
    afterActive.length === 1 &&
    afterActive[0].content === valkey.content &&
    oldRecord?.status === "superseded" &&
    oldRecord?.validUntil !== null;

  console.log("\nTemporal correctness PASS:", temporalCorrect ? "YES" : "NO");

  const slug = scope.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const mirrorPath = join(vaultDir, "knowledge", `${slug}.md`);
  const mirrorContent = await readFile(mirrorPath, "utf-8");
  console.log("\n--- Markdown mirror (" + mirrorPath + ") ---");
  console.log(mirrorContent);

  const mirrorCorrect =
    mirrorContent.includes("Migrated cache backend to Valkey") &&
    !mirrorContent.includes("Uses Redis for caching");
  console.log("Mirror shows only current truth PASS:", mirrorCorrect ? "YES" : "NO");

  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});