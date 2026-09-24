import type { MemoryRecord } from "./schema.js";

export function formatMemoryContext(memories: MemoryRecord[]): string | null {
  if (memories.length === 0) return null;
  const lines = memories.map((m) => `- [${m.type}] ${m.content}`);
  return `Relevant memory from previous sessions:\n${lines.join("\n")}`;
}