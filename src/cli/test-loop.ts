import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { runAgentLoop } from "../core/loop.js";
import { readTool } from "../tools/read.js";
import { editTool } from "../tools/edit.js";
import { listDirectoryTool } from "../tools/list-directory.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);
  const tools = [readTool, editTool, listDirectoryTool];

  const result = await runAgentLoop({
    provider,
    tools,
    systemPrompt: `You are a helpful coding assistant with tool access. You are running on ${process.platform}.`,
    userMessage:
      "Create a file called hello.txt containing a short haiku about TypeScript. Then read it back to confirm it was written correctly.",
    onToolCall: (name, input, result) => {
      console.log(`\n[tool call] ${name}(${JSON.stringify(input)})`);
      console.log(`[result] ${result.slice(0, 200)}`);
    },
  });

  console.log("\n--- Final response ---");
  console.log(result.finalMessage);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});