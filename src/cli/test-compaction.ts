import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { runAgentLoop } from "../core/loop.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);

  let priorMessages: import("../core/provider.js").Message[] = [];

  const turns = [
    "My project is called Investment Research Bot, built with LangGraph and Pinecone.",
    "It uses a two-lane retrieval system: structured XBRL data first, then reranked narrative text.",
    "What's the name of my project and what retrieval approach does it use?",
  ];

  for (const [i, userMessage] of turns.entries()) {
    console.log(`\n=== Turn ${i + 1}: "${userMessage}" ===`);

    const result = await runAgentLoop({
      provider,
      tools: [],
      systemPrompt: "You are a helpful assistant that remembers project details across the conversation.",
      userMessage,
      priorMessages,
      contextBudget: { maxRecentTokens: 40 },
      onCompact: (before, after) => {
        console.log(`[compaction triggered] ${before} messages -> ${after} messages`);
      },
    });

    console.log("Response:", result.finalMessage);
    priorMessages = result.messages;
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});