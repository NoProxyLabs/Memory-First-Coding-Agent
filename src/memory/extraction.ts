import { randomUUID } from "node:crypto";
import type { LLMProvider, Message } from "../core/provider.js";
import type { Episode, MemoryType } from "./schema.js";

// This is the bridge between Phase A (raw session transcripts) and Phase B
// (durable memory). It only *proposes* — the curator (next) decides what
// actually gets written to the vault. Keeping these separate matters: a
// bad extraction just produces bad drafts that the curator can reject,
// rather than bad data landing directly in long-term memory.

const EXTRACTION_SYSTEM_PROMPT = `You review a coding agent's session transcript and extract what's worth remembering long-term.

Output ONLY a JSON object (no markdown fences, no prose) with this exact shape:
{
  "summary": "one or two sentence summary of what happened in this session",
  "outcome": "success" | "failure" | "partial",
  "candidateMemories": [
    {
      "content": "a single durable fact, decision, gotcha, or convention worth remembering",
      "suggestedType": "gotcha" | "architecture" | "decision" | "convention",
      "suggestedScope": "a short scope label, e.g. repo:investment-bot"
    }
  ]
}

Only include candidateMemories that would still be useful in a future, unrelated session on the same project. Skip anything trivial, one-off, or already obvious from the code itself. If nothing is worth remembering, return an empty candidateMemories array. Never invent facts not present in the transcript.`;

function transcriptFromMessages(messages: Message[]): string {
  return messages
    .filter((m) => m.role !== "system")
    .map((m) => {
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        const calls = m.toolCalls.map((c) => `${c.name}(${JSON.stringify(c.input)})`).join(", ");
        return `assistant: [called ${calls}]`;
      }
      if (m.role === "tool") {
        return `tool result (${m.toolCallName}): ${m.content.slice(0, 300)}`;
      }
      return `${m.role}: ${m.content}`;
    })
    .join("\n");
}

interface ExtractionJson {
  summary: string;
  outcome: "success" | "failure" | "partial";
  candidateMemories: Array<{
    content: string;
    suggestedType: MemoryType;
    suggestedScope: string;
  }>;
}

const VALID_TYPES: MemoryType[] = ["gotcha", "architecture", "decision", "convention"];
const VALID_OUTCOMES = ["success", "failure", "partial"];

// The model saying "output only JSON" doesn't guarantee it — validate
// every field explicitly rather than trusting the shape. A malformed
// extraction should fail loudly here, not silently corrupt the vault
// three steps later in the curator.
function parseExtractionResponse(raw: string): ExtractionJson {
  const cleaned = raw.replace(/^```json\s*|```\s*$/g, "").trim();
  const parsed = JSON.parse(cleaned) as unknown;

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Extraction response was not a JSON object");
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.summary !== "string") {
    throw new Error("Extraction response missing 'summary' string");
  }
  if (typeof obj.outcome !== "string" || !VALID_OUTCOMES.includes(obj.outcome)) {
    throw new Error(`Extraction response has invalid 'outcome': ${String(obj.outcome)}`);
  }
  if (!Array.isArray(obj.candidateMemories)) {
    throw new Error("Extraction response missing 'candidateMemories' array");
  }

  const candidateMemories = obj.candidateMemories.map((c, i) => {
    if (typeof c !== "object" || c === null) {
      throw new Error(`candidateMemories[${i}] is not an object`);
    }
    const cm = c as Record<string, unknown>;
    if (typeof cm.content !== "string") {
      throw new Error(`candidateMemories[${i}].content is not a string`);
    }
    if (typeof cm.suggestedType !== "string" || !VALID_TYPES.includes(cm.suggestedType as MemoryType)) {
      throw new Error(`candidateMemories[${i}].suggestedType is invalid: ${String(cm.suggestedType)}`);
    }
    if (typeof cm.suggestedScope !== "string") {
      throw new Error(`candidateMemories[${i}].suggestedScope is not a string`);
    }
    return {
      content: cm.content,
      suggestedType: cm.suggestedType as MemoryType,
      suggestedScope: cm.suggestedScope,
    };
  });

  return { summary: obj.summary, outcome: obj.outcome as ExtractionJson["outcome"], candidateMemories };
}

export interface ExtractEpisodeOptions {
  sessionId: string;
  messages: Message[];
  gitDiff?: string;
  // If set, overrides the model's own suggestedScope guesses on every
  // candidate. Without this, extraction is free to invent a different
  // scope string each call (e.g. "repo:sec-filings" one time,
  // "repo:investment-bot" another) — and since retrieval queries with a
  // fixed scope, any mismatch means memories get written but silently
  // never surface. Pinning it here trades away multi-repo differentiation
  // within one extraction call for a real, working retrieval path.
  defaultScope?: string;
  signal?: AbortSignal;
}

export async function extractEpisode(
  provider: LLMProvider,
  options: ExtractEpisodeOptions
): Promise<Episode> {
  const { sessionId, messages, gitDiff = "", defaultScope, signal } = options;
  const transcript = transcriptFromMessages(messages);
  const diffSection = gitDiff ? `\n\nGit diff for this session:\n${gitDiff}` : "";

  const response = await provider.complete(
    [
      { role: "system", content: EXTRACTION_SYSTEM_PROMPT },
      { role: "user", content: transcript + diffSection },
    ],
    [],
    signal
  );

  const parsed = parseExtractionResponse(response.message.content);
  const candidateMemories = defaultScope
    ? parsed.candidateMemories.map((c) => ({ ...c, suggestedScope: defaultScope }))
    : parsed.candidateMemories;

  return {
    id: randomUUID(),
    sessionId,
    summary: parsed.summary,
    candidateMemories,
    outcome: parsed.outcome,
    createdAt: new Date().toISOString(),
  };
}