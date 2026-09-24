import "dotenv/config";
import { GroqProvider } from "../core/providers/groq.js";
import { runSession } from "../sessions/run-session.js";
import { SessionStore } from "../sessions/store.js";
import { readTool } from "../tools/read.js";
import { editTool } from "../tools/edit.js";
import { listDirectoryTool } from "../tools/list-directory.js";

async function main() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  const provider = new GroqProvider(apiKey);
  const tools = [readTool, editTool, listDirectoryTool];
  const store = new SessionStore(".agent.db");

  const session = store.createSession("resume test");
  console.log("Session:", session.id);

  const first = await runSession({
    store,
    sessionId: session.id,
    provider,
    tools,
    systemPrompt: "You are a helpful coding assistant.",
    userMessage:
      "My favorite programming language is TypeScript. Just acknowledge that, don't use any tools.",
  });
  console.log("\nFirst response:", first);

  const second = await runSession({
    store,
    sessionId: session.id,
    provider,
    tools,
    systemPrompt: "You are a helpful coding assistant.",
    userMessage: "What's my favorite programming language?",
  });
  console.log("\nSecond response (should mention TypeScript):", second);

  store.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});