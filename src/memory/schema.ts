export type MemoryType = "gotcha" | "architecture" | "decision" | "convention";
export type MemoryStatus = "active" | "superseded" | "archived";

export interface MemoryRecord {
  id: string;
  type: MemoryType;
  scope: string;
  content: string;
  status: MemoryStatus;
  createdAt: string;
  validFrom: string;
  validUntil: string | null;
  supersedes: string | null;
  sourceEpisode: string | null;
  confidence: number;
}

export interface MemoryDraft {
  content: string;
  suggestedType: MemoryType;
  suggestedScope: string;
}

export interface Episode {
  id: string;
  sessionId: string;
  summary: string;
  candidateMemories: MemoryDraft[];
  outcome: "success" | "failure" | "partial";
  createdAt: string;
}

export type CuratorAction = "IGNORE" | "CREATE" | "UPDATE_SUPERSEDE";

export interface CuratorDecision {
  action: CuratorAction;
  type?: MemoryType;
  scope?: string;
  newContent?: string;
  oldMemoryId?: string;
  confidence: number;
  reason: string;
}