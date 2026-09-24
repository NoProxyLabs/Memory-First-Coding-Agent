import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { readTool } from "../tools/read.js";
import { createShellTool } from "../tools/shell.js";
import { listDirectoryTool } from "../tools/list-directory.js";
import type { Message } from "../core/provider.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);
  const tools = [readTool, createShellTool(), listDirectoryTool];
  const toolDefs = tools.map((t) => t.definition);

  const messages: Message[] = [
    {
      role: "system",
      content: `You are a helpful assistant with tool access. You are running on ${process.platform}. When you need to run shell commands, use commands appropriate for this OS. Prefer list_directory over shell commands for listing files.`,
    },
    { role: "user", content: "What files are in the current directory?" },
  ];

  const first = await provider.complete(messages, toolDefs);
  console.log("First call stopReason:", first.stopReason);
  console.log("Tool calls:", first.toolCalls);

  if (first.toolCalls.length === 0) {
    console.log("Model didn't call a tool — nothing more to test here.");
    return;
  }

  messages.push({
    role: "assistant",
    content: first.message.content,
    toolCalls: first.toolCalls,
  });

  for (const call of first.toolCalls) {
    const tool = tools.find((t) => t.definition.name === call.name);
    if (!tool) {
      console.log(`No tool registered for "${call.name}"`);
      continue;
    }

    const result = await tool.execute(call.input);
    console.log(`\n--- Executed ${call.name} ---`);
    console.log(result.slice(0, 300));

    messages.push({
      role: "tool",
      content: result,
      toolCallId: call.id,
      toolCallName: call.name,
    });
  }

  const second = await provider.complete(messages, toolDefs);
  console.log("\n--- Final model response ---");
  console.log(second.message.content);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});