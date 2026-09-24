import type { MemoryRecord } from "./schema.js";
import type { MemoryStore } from "./vault-store.js";
import { stemmer } from "stemmer";

// The whole point compared to "just do vector search": retrieval is scoped
// first (only memories for this project even enter ranking), then ranked
// by lexical relevance to the current task. No embeddings, no vector DB —
// per the plan, those get added later only if this demonstrably falls
// short in the eval, not by default.

function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  return words.map(stemmer);
}

interface ScoredMemory {
  memory: MemoryRecord;
  score: number;
}

const K1 = 1.5;
const B = 0.75;

// A small, hand-rolled BM25 over the candidate set. The corpus here is
// "active memories in one scope" — small enough that a real ranking
// function costs nothing, and it's a more honest "I understand retrieval"
// story than keyword-overlap scoring dressed up as search.
function bm25Rank(query: string, documents: MemoryRecord[]): ScoredMemory[] {
  const queryTerms = tokenize(query);
  if (queryTerms.length === 0 || documents.length === 0) {
    return documents.map((memory) => ({ memory, score: 0 }));
  }

  const docTokens = documents.map((d) => tokenize(d.content));
  const docLengths = docTokens.map((t) => t.length);
  const avgDocLength = docLengths.reduce((a, b) => a + b, 0) / docLengths.length || 1;
  const N = documents.length;

  const df = new Map<string, number>();
  for (const term of new Set(queryTerms)) {
    df.set(term, docTokens.filter((tokens) => tokens.includes(term)).length);
  }

  const scored = documents.map((memory, i) => {
    const tokens = docTokens[i];
    const docLength = docLengths[i];
    let score = 0;

    for (const term of queryTerms) {
      const n = df.get(term) ?? 0;
      if (n === 0) continue;
      const idf = Math.log((N - n + 0.5) / (n + 0.5) + 1);
      const tf = tokens.filter((t) => t === term).length;
      const denom = tf + K1 * (1 - B + (B * docLength) / avgDocLength);
      score += idf * ((tf * (K1 + 1)) / (denom || 1));
    }

    return { memory, score };
  });

  return scored.sort((a, b) => b.score - a.score);
}

export interface RetrieveOptions {
  scope: string;
  query: string;
  limit?: number;
}

export function retrieveMemories(store: MemoryStore, options: RetrieveOptions): MemoryRecord[] {
  const { scope, query, limit = 5 } = options;
  const candidates = store.listMemories(scope, "active");
  const ranked = bm25Rank(query, candidates);
  return ranked
    .filter((r) => r.score > 0)
    .slice(0, limit)
    .map((r) => r.memory);
}