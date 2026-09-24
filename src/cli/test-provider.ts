import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import type { Message, ToolDefinition } from "../core/provider.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Set GROQ_API_KEY in your .env file first.");
  }

  const provider = new GroqProvider(apiKey);

  const tools: ToolDefinition[] = [
    {
      name: "get_current_time",
      description: "Returns the current time. Use this if asked what time it is.",
      inputSchema: { type: "object", properties: {}, required: [] },
    },
  ];

  const messages: Message[] = [
    { role: "system", content: "You are a helpful assistant with tool access." },
    { role: "user", content: "What time is it right now?" },
  ];

  const response = await provider.complete(messages, tools);

  console.log("stopReason:", response.stopReason);
  console.log("message:", response.message);
  console.log("toolCalls:", response.toolCalls);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});