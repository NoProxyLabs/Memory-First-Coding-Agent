// Every concrete tool (read, edit, shell, grep, git) implements this.
// "definition" is what gets sent to the LLM provider (name/description/schema
// from provider.ts). "execute" is what actually runs when the model calls it.
//
// Keeping these together in one object (rather than a separate registry
// mapping names to functions) means a tool can't drift out of sync with its
// own schema — the definition and the implementation live in the same file.

import type { ToolDefinition } from "../core/provider.js";

export interface Tool {
  definition: ToolDefinition;
  execute(input: Record<string, unknown>): Promise<string>;
  // Tools return a plain string — that string becomes the "tool" message
  // content fed back to the model. Keep it human-readable; the model reads
  // it the same way you would.
}