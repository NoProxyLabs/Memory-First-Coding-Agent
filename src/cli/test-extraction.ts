import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { extractEpisode } from "../memory/extraction.js";
import type { Message } from "../core/provider.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);

  // A fabricated but realistic transcript: one architectural decision worth
  // remembering (two-lane retrieval), one genuine gotcha worth remembering
  // (pagination cursor bug), and one throwaway detail that should NOT
  // become a memory (just checking the current time).
  const messages: Message[] = [
    { role: "system", content: "You are a coding assistant." },
    { role: "user", content: "What time is it?" },
    { role: "assistant", content: "I don't have real-time clock access in this context." },
    {
      role: "user",
      content:
        "We decided to use a two-lane retrieval architecture: structured XBRL data first, then reranked narrative text. Also, I found that duplicate SEC filings were caused by the pagination cursor not resetting between filings — fixed it.",
    },
    {
      role: "assistant",
      content:
        "Got it — noted the two-lane retrieval design and the pagination cursor fix. Both are now reflected in the codebase.",
    },
  ];

  // Deliberately contains specifics (offset/lastSeenId reset logic, and the
  // function name itself) that appear NOWHERE in the chat text above — the
  // chat only describes the fix in prose. If extraction picks any of these
  // up, that's real proof the diff is being read and used, not just passed
  // through unused.
  const gitDiff = `diff --git a/src/retrieval/pagination.ts b/src/retrieval/pagination.ts
index abc123..def456 100644
--- a/src/retrieval/pagination.ts
+++ b/src/retrieval/pagination.ts
@@ -10,6 +10,10 @@
+export function resetPaginationCursor(cursor: PaginationCursor): void {
+  cursor.offset = 0;
+  cursor.lastSeenId = null;
+}`;

  const episode = await extractEpisode(provider, {
    sessionId: "test-session-id",
    messages,
    gitDiff,
  });

  console.log("Episode summary:", episode.summary);
  console.log("Outcome:", episode.outcome);
  console.log("\nCandidate memories:");
  episode.candidateMemories.forEach((m, i) => {
    console.log(`  ${i + 1}. [${m.suggestedType}] (${m.suggestedScope}) ${m.content}`);
  });

  // Sanity checks — not a strict test (model judgment varies), but a
  // useful signal on whether extraction is doing something reasonable.
  const mentionsRetrieval = episode.candidateMemories.some((m) =>
    m.content.toLowerCase().includes("retrieval") || m.content.toLowerCase().includes("xbrl")
  );
  const mentionsCursor = episode.candidateMemories.some((m) =>
    m.content.toLowerCase().includes("cursor") || m.content.toLowerCase().includes("pagination")
  );
  const skippedTimeQuestion = !episode.candidateMemories.some((m) =>
    m.content.toLowerCase().includes("time")
  );

  console.log("\nCaptured the retrieval decision:", mentionsRetrieval);
  console.log("Captured the cursor gotcha:", mentionsCursor);
  console.log("Correctly skipped the throwaway time question:", skippedTimeQuestion);

  // Check against several diff-only terms, not just one exact function
  // name — the model might paraphrase which specific term it echoes back,
  // so any of these appearing is real evidence the diff was read, none of
  // them being fragile to exactly which one it picked.
  const diffOnlyTerms = ["resetPaginationCursor", "offset", "lastSeenId"];
  const mentionsFunctionFromDiff = episode.candidateMemories.some((m) =>
    diffOnlyTerms.some((term) => m.content.includes(term))
  );
  console.log("Diff content actually used (mentions a diff-only term):", mentionsFunctionFromDiff);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});