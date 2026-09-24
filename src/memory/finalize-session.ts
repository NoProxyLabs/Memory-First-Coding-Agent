import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { LLMProvider, Message } from "../core/provider.js";
import type { MemoryStore } from "./vault-store.js";
import { extractEpisode } from "./extraction.js";
import { processEpisode, type CuratorDecisionEvent } from "./process-episode.js";
import { getSessionDiff } from "./git-diff.js";

// Phase C plumbing: append every curator decision to a JSONL dataset file.
// Deliberately dumb — one line per decision, no batching, no in-memory
// buffering — because losing a session's worth of decisions to a crash is
// a much worse failure mode than the tiny cost of an appendFile per
// decision. This file is meant to accumulate across every project you
// dogfood on, not just this repo, so it lives under trainingDataDir
// (caller decides where — see main.ts, which points it at a fixed
// location under the home directory, independent of whichever project
// dir the process has chdir'd into).
async function logCuratorDecision(
  trainingDataDir: string,
  sessionId: string,
  scope: string,
  event: CuratorDecisionEvent
): Promise<void> {
  await mkdir(trainingDataDir, { recursive: true });
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    sessionId,
    scope,
    input: {
      draft: event.draft,
      existingMemories: event.existingMemories.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
      })),
    },
    output: event.decision,
  });
  // Append failures shouldn't take down the pipeline that's actually
  // writing to the real memory vault — log and move on.
  try {
    await appendFile(join(trainingDataDir, "curator-decisions.jsonl"), line + "\n", "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`  [training-data] failed to log curator decision (continuing anyway): ${message}`);
  }
}

// Called when a session finishes (on /exit, or before switching away via
// /new or /resume) — turns that session's transcript into durable memory.
//
// Known v1 simplification: this reprocesses the session's FULL message
// history every time it's called, not just what's new since the last
// finalize. If a session gets resumed and finalized again later, its
// earlier turns get re-extracted and re-curated (the curator's own
// duplicate-detection against existing memories should mostly absorb
// this as IGNORE decisions, but it's real repeated work, not free). A
// "processed up to" pointer would fix this properly — not building that
// now, since it only matters once resume-then-finalize-again is a
// realistic usage pattern, not a hypothetical one.
export async function finalizeSession(
  provider: LLMProvider,
  memoryStore: MemoryStore,
  sessionId: string,
  messages: Message[],
  scope: string,
  // Omit to skip decision logging entirely; pass a fixed, project-independent
  // path (see main.ts) to have every curator decision from this session
  // appended to a growing JSONL dataset — the raw material for Phase C.
  trainingDataDir?: string
): Promise<number> {
  const hasRealContent = messages.some((m) => m.role !== "system");
  if (!hasRealContent) {
    return 0;
  }

  const gitDiff = await getSessionDiff();
  const episode = await extractEpisode(provider, {
    sessionId,
    messages,
    gitDiff,
    defaultScope: scope,
  });

  if (episode.candidateMemories.length === 0) {
    return 0;
  }

  const results = await processEpisode(provider, memoryStore, episode, {
    onCuratorDecision: trainingDataDir
      ? (event) => {
          void logCuratorDecision(trainingDataDir, sessionId, scope, event);
        }
      : undefined,
  });
  return results.filter((r) => r.memoryId !== null).length;
}