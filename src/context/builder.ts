import type { Message } from "../core/provider.js";

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

// Estimate tokens for one message. Char-count/4 is still a rough heuristic —
// good enough to decide *when* to compact, not meant to match a real
// tokenizer exactly.
//
// The real fix here: an assistant message that makes a tool call has
// `content: ""` with its actual payload sitting in `toolCalls` instead. The
// old version only measured `message.content.length`, so every tool-call
// message — which is most of what this agent's messages will be — was
// silently counted as ~0 tokens.
export function estimateTokens(message: Message): number {
  let chars = message.content.length;
  if (message.toolCalls) {
    for (const call of message.toolCalls) {
      chars += call.name.length + safeJsonStringify(call.input).length;
    }
  }
  return Math.ceil(chars / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
  return messages.reduce((sum, m) => sum + estimateTokens(m), 0);
}

export interface ContextBudget {
  maxRecentTokens: number; // once the non-system tail exceeds this, compaction triggers
}