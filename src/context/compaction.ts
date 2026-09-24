import type { LLMProvider, Message } from "../core/provider.js";
import { estimateMessagesTokens, type ContextBudget } from "./builder.js";

// Compaction only shrinks the live context — it is NOT the same operation
// as memory formation (that's Phase B: deciding what's worth keeping
// forever). This just keeps the conversation small enough to keep going.
// The system message (index 0, the stable prefix) is never touched.

async function summarizeMessages(
  provider: LLMProvider,
  messages: Message[],
  signal?: AbortSignal
): Promise<string> {
  const transcript = messages.map((m) => `${m.role}: ${m.content}`).join("\n");

  try {
    const response = await provider.complete(
      [
        {
          role: "system",
          content:
            "Summarize the following conversation concisely, preserving important facts, decisions, and current task state. Output only the summary, no preamble.",
        },
        { role: "user", content: transcript },
      ],
      [],
      signal
    );

    return response.message.content;
  } catch (err) {
    // A non-retryable failure here (most likely a 413 — the content itself
    // is too large to summarize in one request) means no amount of
    // retrying fixes it. Fall back to a blunt truncation rather than
    // letting this failure kill the whole turn — a degraded summary beats
    // a permanently unusable session. Re-throw abort errors as-is so
    // Ctrl+C still cancels cleanly instead of silently "succeeding" with
    // a fallback summary.
    if (signal?.aborted) throw err;

    const capped = transcript.slice(0, 4000);
    return `[Summary generation failed — content was too large to summarize in one request. Truncated raw excerpt follows:]\n${capped}\n[... remainder discarded ...]`;
  }
}

// A "turn" is one user message plus everything that follows it (assistant
// tool-calls and their tool-result replies) until the next user message.
// Cutting anywhere except a user-message boundary risks splitting a
// tool_call from its tool_result — an orphaned tool message with no
// matching call above it, which most provider APIs reject outright.
//
// Walking backward from the desired midpoint to the nearest user message
// guarantees the "recent" half always starts clean, because every
// assistant/tool pair in a turn is fully contained between two user
// messages — it can never straddle this cut point.
function findCutPoint(rest: Message[], desiredIndex: number): number {
  for (let i = Math.min(desiredIndex, rest.length - 1); i >= 0; i--) {
    if (rest[i].role === "user") {
      return i;
    }
  }
  return 0; // no user boundary found — nothing safe to cut yet
}

export async function maybeCompact(
  provider: LLMProvider,
  messages: Message[],
  budget: ContextBudget,
  signal?: AbortSignal
): Promise<{ messages: Message[]; compacted: boolean }> {
  const [systemMsg, ...rest] = messages;

  if (estimateMessagesTokens(rest) <= budget.maxRecentTokens) {
    return { messages, compacted: false };
  }

  const desiredHalf = Math.floor(rest.length / 2);
  const cutIndex = findCutPoint(rest, desiredHalf);

  if (cutIndex <= 1) {
    // Nothing meaningful to compact yet — either we're still in the first
    // turn, or the only thing before the cut is a single earlier summary.
    // Re-summarizing one message wastes a call and risks compounding drift
    // (Pi avoids this with a distinguished previousSummary field; we don't
    // have that yet, so just skip instead of degrading it for free).
    return { messages, compacted: false };
  }

  const older = rest.slice(0, cutIndex);
  const recent = rest.slice(cutIndex);

  const summaryText = await summarizeMessages(provider, older, signal);
  const summaryMsg: Message = {
    role: "system",
    content: `[Compacted summary of earlier conversation]\n${summaryText}`,
  };

  return { messages: [systemMsg, summaryMsg, ...recent], compacted: true };
}