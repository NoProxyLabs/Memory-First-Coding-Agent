import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type { Message, ToolCall } from "../core/provider.js";

export interface SessionRecord {
  id: string;
  label: string | null;
  createdAt: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.init();
  }

  private init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        label TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_call_id TEXT,
        tool_call_name TEXT,
        tool_calls_json TEXT,
        timestamp TEXT NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, seq);
    `);
  }

  createSession(label?: string): SessionRecord {
    const record: SessionRecord = {
      id: randomUUID(),
      label: label ?? null,
      createdAt: new Date().toISOString(),
    };
    this.db
      .prepare("INSERT INTO sessions (id, label, created_at) VALUES (?, ?, ?)")
      .run(record.id, record.label, record.createdAt);
    return record;
  }

  appendMessage(sessionId: string, message: Message): void {
    const { nextSeq } = this.db
      .prepare(
        `SELECT COALESCE(MAX(seq), -1) + 1 AS nextSeq FROM messages WHERE session_id = ?`
      )
      .get(sessionId) as { nextSeq: number };
    this.db
      .prepare(
        `INSERT INTO messages
          (session_id, seq, role, content, tool_call_id, tool_call_name, tool_calls_json, timestamp)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        sessionId,
        nextSeq,
        message.role,
        message.content,
        message.toolCallId ?? null,
        message.toolCallName ?? null,
        message.toolCalls ? JSON.stringify(message.toolCalls) : null,
        new Date().toISOString()
      );
  }

  getMessages(sessionId: string): Message[] {
    const rows = this.db
      .prepare(
        `SELECT role, content, tool_call_id, tool_call_name, tool_calls_json
         FROM messages WHERE session_id = ? ORDER BY seq ASC`
      )
      .all(sessionId) as Array<{
        role: Message["role"];
        content: string;
        tool_call_id: string | null;
        tool_call_name: string | null;
        tool_calls_json: string | null;
      }>;

    return rows.map((r) => ({
      role: r.role,
      content: r.content,
      ...(r.tool_call_id ? { toolCallId: r.tool_call_id } : {}),
      ...(r.tool_call_name ? { toolCallName: r.tool_call_name } : {}),
      ...(r.tool_calls_json
        ? { toolCalls: JSON.parse(r.tool_calls_json) as ToolCall[] }
        : {}),
    }));
  }

  listSessions(): SessionRecord[] {
    const rows = this.db
      .prepare("SELECT id, label, created_at FROM sessions ORDER BY created_at DESC")
      .all() as Array<{ id: string; label: string | null; created_at: string }>;
    return rows.map((r) => ({ id: r.id, label: r.label, createdAt: r.created_at }));
  }

  close(): void {
    this.db.close();
  }
}