import type { LLMProvider } from "../core/provider.js";
import type { MemoryDraft, MemoryRecord, MemoryType, CuratorAction, CuratorDecision } from "./schema.js";

// This is the actual differentiator of the whole project — the piece that
// decides what's worth persisting instead of just persisting everything
// extraction proposed. Extraction is a first-pass filter (a session-level
// "what happened"); the curator is a scope-level filter that also checks
// against what's *already known*, which is what lets it recognize
// duplicates and contradictions extraction alone can't see (extraction
// only ever looks at one session in isolation).

const CURATOR_SYSTEM_PROMPT = `You decide what to do with a single candidate memory for a coding agent's long-term memory store.

You will be given:
1. A candidate memory (a fact someone proposed remembering)
2. A list of memories already active for this scope

Decide exactly one action:
- "IGNORE": the candidate is trivial, redundant with an existing memory (says the same thing), or not durable enough to be worth remembering.
- "CREATE": the candidate is genuinely new information not covered by any existing memory.
- "UPDATE_SUPERSEDE": the candidate contradicts or replaces an existing memory (e.g. an architecture change, a fixed gotcha that's no longer relevant in its old form). You must identify which existing memory it supersedes.

Output ONLY a JSON object (no markdown fences, no prose) with this exact shape:
{
  "action": "IGNORE" | "CREATE" | "UPDATE_SUPERSEDE",
  "type": "gotcha" | "architecture" | "decision" | "convention",
  "newContent": "the memory content to store (required for CREATE and UPDATE_SUPERSEDE, omit for IGNORE)",
  "oldMemoryId": "id of the memory being superseded (required for UPDATE_SUPERSEDE only)",
  "confidence": 0.0 to 1.0,
  "reason": "one short sentence explaining the decision"
}`;

interface CuratorJson {
  action: CuratorAction;
  type?: MemoryType;
  newContent?: string;
  oldMemoryId?: string;
  confidence: number;
  reason: string;
}

const VALID_ACTIONS: CuratorAction[] = ["IGNORE", "CREATE", "UPDATE_SUPERSEDE"];
const VALID_TYPES: MemoryType[] = ["gotcha", "architecture", "decision", "convention"];

function parseCuratorResponse(raw: string, existingIds: Set<string>): CuratorJson {
  const cleaned = raw.replace(/^```json\s*|```\s*$/g, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Curator response was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.action !== "string" || !VALID_ACTIONS.includes(obj.action as CuratorAction)) {
    throw new Error(`Curator response has invalid 'action': ${String(obj.action)}`);
  }
  const action = obj.action as CuratorAction;

  if (typeof obj.confidence !== "number" || obj.confidence < 0 || obj.confidence > 1) {
    throw new Error(`Curator response has invalid 'confidence': ${String(obj.confidence)}`);
  }
  if (typeof obj.reason !== "string") {
    throw new Error("Curator response missing 'reason' string");
  }

  if (action === "CREATE" || action === "UPDATE_SUPERSEDE") {
    if (typeof obj.type !== "string" || !VALID_TYPES.includes(obj.type as MemoryType)) {
      throw new Error(`Curator response has invalid 'type' for ${action}: ${String(obj.type)}`);
    }
    if (typeof obj.newContent !== "string" || obj.newContent.length === 0) {
      throw new Error(`Curator response missing 'newContent' for ${action}`);
    }
  }

  if (action === "UPDATE_SUPERSEDE") {
    if (typeof obj.oldMemoryId !== "string" || !existingIds.has(obj.oldMemoryId)) {
      throw new Error(
        `Curator response has invalid 'oldMemoryId' for UPDATE_SUPERSEDE: ${String(obj.oldMemoryId)} (must match a provided existing memory)`
      );
    }
  }

  return {
    action,
    type: obj.type as MemoryType | undefined,
    newContent: obj.newContent as string | undefined,
    oldMemoryId: obj.oldMemoryId as string | undefined,
    confidence: obj.confidence,
    reason: obj.reason,
  };
}

export async function curateMemory(
  provider: LLMProvider,
  draft: MemoryDraft,
  existingMemories: MemoryRecord[],
  signal?: AbortSignal
): Promise<CuratorDecision> {
  const existingSummary =
    existingMemories.length > 0
      ? existingMemories.map((m) => `- [id: ${m.id}] (${m.type}) ${m.content}`).join("\n")
      : "(none)";

  const userContent = `Candidate memory:
(${draft.suggestedType}) ${draft.content}
Scope: ${draft.suggestedScope}

Existing active memories for this scope:
${existingSummary}`;

  const response = await provider.complete(
    [
      { role: "system", content: CURATOR_SYSTEM_PROMPT },
      { role: "user", content: userContent },
    ],
    [],
    signal
  );

  const existingIds = new Set(existingMemories.map((m) => m.id));
  const parsed = parseCuratorResponse(response.message.content, existingIds);

  return {
    action: parsed.action,
    type: parsed.type,
    scope: draft.suggestedScope,
    newContent: parsed.newContent,
    oldMemoryId: parsed.oldMemoryId,
    confidence: parsed.confidence,
    reason: parsed.reason,
  };
}