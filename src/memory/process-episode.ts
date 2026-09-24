import type { LLMProvider } from "../core/provider.js";
import type { Episode, CuratorDecision, MemoryDraft, MemoryRecord } from "./schema.js";
import { curateMemory } from "./curator.js";
import { MemoryStore } from "./vault-store.js";

export interface ProcessedDraft {
  decision: CuratorDecision;
  memoryId: string | null; // set only when the decision resulted in a vault write
}

// Fired once per candidate draft, right after the curator resolves, with
// everything that went into and came out of that one decision. This is
// the Phase C hook: it's the only place in the pipeline that sees the
// exact (draft, existingMemories) -> decision triple, which is exactly
// the input/output pair a fine-tuned curator needs to be trained on.
// Kept as a plain callback (same shape as onToolCall/onMessage elsewhere
// in this codebase) rather than writing JSONL here directly — I/O belongs
// in the caller (finalize-session.ts), not in this orchestration file.
export interface CuratorDecisionEvent {
  draft: MemoryDraft;
  existingMemories: MemoryRecord[];
  decision: CuratorDecision;
}

export interface ProcessEpisodeOptions {
  signal?: AbortSignal;
  onCuratorDecision?: (event: CuratorDecisionEvent) => void;
}

// This is the whole memory pipeline's write path in one place: for each
// candidate draft an episode produced, ask the curator what to do about
// it (given what's already known in that scope), then actually perform
// the vault write if the decision calls for one. IGNORE decisions never
// touch the vault at all — that's the point of having a curator instead
// of writing every draft straight through.
export async function processEpisode(
  provider: LLMProvider,
  store: MemoryStore,
  episode: Episode,
  options: ProcessEpisodeOptions = {}
): Promise<ProcessedDraft[]> {
  const { signal, onCuratorDecision } = options;
  const results: ProcessedDraft[] = [];

  for (const draft of episode.candidateMemories) {
    const existing = store.listMemories(draft.suggestedScope, "active");
    const decision = await curateMemory(provider, draft, existing, signal);

    onCuratorDecision?.({ draft, existingMemories: existing, decision });

    if (decision.action === "IGNORE") {
      results.push({ decision, memoryId: null });
      continue;
    }

    // Both CREATE and UPDATE_SUPERSEDE end up as a createMemory() call —
    // the only difference is whether `supersedes` is set. This mirrors
    // MemoryStore's own design: superseding an old record and creating a
    // new one happen as one atomic operation, not two separate steps.
    const record = await store.createMemory({
      type: decision.type!,
      scope: decision.scope!,
      content: decision.newContent!,
      sourceEpisode: episode.id,
      confidence: decision.confidence,
      supersedes: decision.action === "UPDATE_SUPERSEDE" ? decision.oldMemoryId : null,
    });

    results.push({ decision, memoryId: record.id });
  }

  return results;
}