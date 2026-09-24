import { SessionStore } from "../sessions/store.js";
import type { Message } from "../core/provider.js";

function main() {
  const store = new SessionStore(".agent-test.db");

  const session = store.createSession("test session");
  console.log("Created session:", session);

  const messages: Message[] = [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello" },
    {
      role: "assistant",
      content: "",
      toolCalls: [{ id: "call_1", name: "get_time", input: {} }],
    },
    { role: "tool", content: "3:00 PM", toolCallId: "call_1", toolCallName: "get_time" },
    { role: "assistant", content: "It's 3:00 PM." },
  ];

  for (const m of messages) {
    store.appendMessage(session.id, m);
  }

  const loaded = store.getMessages(session.id);
  console.log("\nLoaded back", loaded.length, "messages:");
  console.log(JSON.stringify(loaded, null, 2));

  const roundTripOk = JSON.stringify(loaded) === JSON.stringify(messages);
  console.log("\nRound-trip match:", roundTripOk ? "PASS" : "FAIL");

  console.log("\nAll sessions:", store.listSessions());

  store.close();
}

main();