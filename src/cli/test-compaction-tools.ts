import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { runAgentLoop } from "../core/loop.js";
import { editTool } from "../tools/edit.js";
import { readTool } from "../tools/read.js";
import type { Message } from "../core/provider.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);
  const tools = [editTool, readTool];

  let priorMessages: Message[] = [];

  const turns = [
    "Write a file called notes1.txt containing the text 'first note'.",
    "Write a file called notes2.txt containing the text 'second note'.",
    "Read back notes1.txt and notes2.txt and confirm both contents.",
  ];

  for (const [i, userMessage] of turns.entries()) {
    console.log(`\n=== Turn ${i + 1}: "${userMessage}" ===`);

    const result = await runAgentLoop({
      provider,
      tools,
      systemPrompt: "You are a helpful coding assistant with tool access.",
      userMessage,
      priorMessages,
      contextBudget: { maxRecentTokens: 60 },
      onCompact: (before, after) => {
        console.log(`[compaction triggered] ${before} messages -> ${after} messages`);
      },
    });

    console.log("Response:", result.finalMessage);
    priorMessages = result.messages;

    const summaryIndex = priorMessages.findIndex((m) =>
      m.content.startsWith("[Compacted summary")
    );
    if (summaryIndex !== -1) {
      const next = priorMessages[summaryIndex + 1];
      const ok = next?.role === "user";
      console.log(
        `[structural check] message after summary has role "${next?.role}" — ${ok ? "PASS" : "FAIL"}`
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});