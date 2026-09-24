import { SessionStore } from "./store.js";
import { runAgentLoop } from "../core/loop.js";
import type { LLMProvider } from "../core/provider.js";
import type { Tool } from "../tools/types.js";
import type { ContextBudget } from "../context/builder.js";

export interface RunSessionOptions {
  store: SessionStore;
  sessionId: string;
  provider: LLMProvider;
  tools: Tool[];
  systemPrompt: string;
  userMessage: string;
  maxIterations?: number;
  onToolCall?: (name: string, input: Record<string, unknown>, result: string) => void;
  contextBudget?: ContextBudget;
  onCompact?: (before: number, after: number) => void;
  signal?: AbortSignal;
  retrieveContext?: (userMessage: string) => Promise<string | null>;
}

export async function runSession(options: RunSessionOptions): Promise<string> {
  const {
    store,
    sessionId,
    provider,
    tools,
    systemPrompt,
    userMessage,
    maxIterations,
    onToolCall,
    contextBudget,
    onCompact,
    signal,
    retrieveContext,
  } = options;

  const priorMessages = store.getMessages(sessionId);

  const result = await runAgentLoop({
    provider,
    tools,
    systemPrompt,
    userMessage,
    priorMessages,
    maxIterations,
    onToolCall,
    contextBudget,
    onCompact,
    signal,
    retrieveContext,
    onMessage: (message) => store.appendMessage(sessionId, message),
  });

  return result.finalMessage;
}