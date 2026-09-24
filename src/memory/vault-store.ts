import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { MemoryRecord, MemoryType, MemoryStatus } from "./schema.js";

export interface CreateMemoryInput {
  type: MemoryType;
  scope: string;
  content: string;
  sourceEpisode: string | null;
  confidence: number;
  supersedes?: string | null;
}

interface MemoryRow {
  id: string;
  type: string;
  scope: string;
  content: string;
  status: string;
  created_at: string;
  valid_from: string;
  valid_until: string | null;
  supersedes: string | null;
  source_episode: string | null;
  confidence: number;
}

function rowToRecord(row: MemoryRow): MemoryRecord {
  return {
    id: row.id,
    type: row.type as MemoryType,
    scope: row.scope,
    content: row.content,
    status: row.status as MemoryStatus,
    createdAt: row.created_at,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
    supersedes: row.supersedes,
    sourceEpisode: row.source_episode,
    confidence: row.confidence,
  };
}

export class MemoryStore {
  private db: Database.Database;
  private vaultDir: string;

  constructor(dbPath: string, vaultDir: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.vaultDir = vaultDir;
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        scope TEXT NOT NULL,
        content TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        valid_from TEXT NOT NULL,
        valid_until TEXT,
        supersedes TEXT,
        source_episode TEXT,
        confidence REAL NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_memories_scope_status
        ON memories(scope, status);
    `);
  }

  async createMemory(input: CreateMemoryInput): Promise<MemoryRecord> {
    const now = new Date().toISOString();
    const record: MemoryRecord = {
      id: randomUUID(),
      type: input.type,
      scope: input.scope,
      content: input.content,
      status: "active",
      createdAt: now,
      validFrom: now,
      validUntil: null,
      supersedes: input.supersedes ?? null,
      sourceEpisode: input.sourceEpisode,
      confidence: input.confidence,
    };

    this.db
      .prepare(
        `INSERT INTO memories
          (id, type, scope, content, status, created_at, valid_from, valid_until, supersedes, source_episode, confidence)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        record.id,
        record.type,
        record.scope,
        record.content,
        record.status,
        record.createdAt,
        record.validFrom,
        record.validUntil,
        record.supersedes,
        record.sourceEpisode,
        record.confidence
      );

    if (input.supersedes) {
      this.db
        .prepare(`UPDATE memories SET status = 'superseded', valid_until = ? WHERE id = ?`)
        .run(now, input.supersedes);
    }

    await this.mirrorToVault(record.scope);
    return record;
  }

  getMemory(id: string): MemoryRecord | null {
    const row = this.db.prepare(`SELECT * FROM memories WHERE id = ?`).get(id) as
      | MemoryRow
      | undefined;
    return row ? rowToRecord(row) : null;
  }

  listMemories(scope?: string, status: MemoryStatus = "active"): MemoryRecord[] {
    const rows = scope
      ? (this.db
          .prepare(`SELECT * FROM memories WHERE scope = ? AND status = ? ORDER BY created_at DESC`)
          .all(scope, status) as MemoryRow[])
      : (this.db
          .prepare(`SELECT * FROM memories WHERE status = ? ORDER BY created_at DESC`)
          .all(status) as MemoryRow[]);
    return rows.map(rowToRecord);
  }

  private async mirrorToVault(scope: string): Promise<void> {
    const slug = scope.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
    const dir = join(this.vaultDir, "knowledge");
    await mkdir(dir, { recursive: true });

    const active = this.listMemories(scope, "active");
    const lines = [
      `# Memory: ${scope}`,
      "",
      ...active.map(
        (m) =>
          `- **[${m.type}]** ${m.content} _(confidence: ${m.confidence}, since: ${m.validFrom})_`
      ),
    ];

    await writeFile(join(dir, `${slug}.md`), lines.join("\n") + "\n", "utf-8");
  }

  close(): void {
    this.db.close();
  }
}