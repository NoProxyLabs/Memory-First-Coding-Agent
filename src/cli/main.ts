import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { homedir } from "node:os";
import { createInterface } from "node:readline/promises";
import { GroqProvider } from "../core/providers/groq.js";
import { getAgentStateDir } from "../core/agent-paths.js";
import { SessionStore } from "../sessions/store.js";
import { runSession } from "../sessions/run-session.js";
import { readTool } from "../tools/read.js";
import { editTool } from "../tools/edit.js";
import { grepTool } from "../tools/grep.js";
import { createShellTool } from "../tools/shell.js";
import { listDirectoryTool } from "../tools/list-directory.js";
import type { Tool } from "../tools/types.js";
import type { ContextBudget } from "../context/builder.js";
import { MemoryStore } from "../memory/vault-store.js";
import { retrieveMemories } from "../memory/retrieval.js";
import { formatMemoryContext } from "../memory/format-context.js";
import { finalizeSession } from "../memory/finalize-session.js";

const SYSTEM_PROMPT =
  "You are a coding agent with access to tools for reading, editing, searching, " +
  "and running shell/git commands. Use tools when you need real information " +
  "instead of guessing. Be direct and concise in your responses. " +
  "Important facts from this conversation are automatically extracted into " +
  "long-term memory when the session ends — you do not need to (and should " +
  "not) manually create note files to remember things for later sessions.";

const DEFAULT_CONTEXT_BUDGET: ContextBudget = { maxRecentTokens: 4000 };

// Fixed, project-independent — homedir() never changes even after we
// process.chdir() into whichever repo we're dogfooding against below, so
// every project's curator decisions land in ONE growing dataset here,
// instead of getting scattered into each repo's own state folder. That's
// what makes "test on 3-4 different repos" actually produce one combined
// training set instead of four disconnected ones.
const TRAINING_DATA_DIR = join(homedir(), ".coding-agent", "training-data");

function printHelp(): void {
  console.log(`
Commands:
  /new [label]     start a new session (optionally labeled)
  /sessions        list all sessions
  /resume <id>     resume an existing session by id (or a unique prefix)
  /help            show this message
  /exit            quit
`);
}

async function main(): Promise<void> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY in your .env file first.");

  // Optional positional arg: which project this run should operate
  // against. Deliberately launched from coding-agent's own directory
  // (so npx/tsx resolves locally and dotenv/config — already run at
  // import time, above — finds YOUR .env, not one you'd have to
  // duplicate into every repo you test on) and then re-rooted via
  // chdir before anything else touches disk. Every relative-path call
  // downstream (tools' default ".", git-diff's cwd, getAgentStateDir's
  // process.cwd() derivation) picks this up automatically — no changes
  // needed anywhere else in the codebase.
  const projectArg = process.argv[2];
  if (projectArg) {
    const resolved = resolve(projectArg);
    try {
      process.chdir(resolved);
    } catch (err) {
      throw new Error(
        `Can't operate on "${resolved}" — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }
  console.log(`Operating on: ${process.cwd()}\n`);

  // Computed HERE, after the chdir above — not as a top-level const.
  // basename(process.cwd()) would otherwise be evaluated at module load
  // time, before main() (and its chdir) ever runs, permanently freezing
  // every session's scope to whichever directory you happened to launch
  // the process from. That's the bug that would have quietly kept
  // filing every project's memories under repo:coding-agent regardless
  // of the --project-style arg above.
  const MEMORY_SCOPE = `repo:${basename(process.cwd())}`;

  const stateDir = getAgentStateDir();
  await mkdir(stateDir, { recursive: true });
  await writeFile(
    join(stateDir, "project.json"),
    JSON.stringify({ targetDir: process.cwd() }, null, 2),
    "utf-8"
  );

  const provider = new GroqProvider(apiKey);
  const store = new SessionStore(join(stateDir, "sessions.db"));
  const memoryStore = new MemoryStore(join(stateDir, "memories.db"), join(stateDir, "vault"));
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const shellTool = createShellTool({
    confirm: async (command) => {
      const answer = (
        await rl.question(
          `\n⚠️  About to run a potentially destructive command:\n  ${command}\nProceed? (y/N) `
        )
      )
        .trim()
        .toLowerCase();
      return answer === "y" || answer === "yes";
    },
  });

  const TOOLS: Tool[] = [readTool, editTool, grepTool, shellTool, listDirectoryTool];

  let sessionId: string | undefined;

  async function finalizeCurrentSession(): Promise<void> {
    if (!sessionId) return;
    const messages = store.getMessages(sessionId);
    try {
      const written = await finalizeSession(
        provider,
        memoryStore,
        sessionId,
        messages,
        MEMORY_SCOPE,
        TRAINING_DATA_DIR
      );
      if (written > 0) {
        console.log(`  [memory] saved ${written} memorie(s) from this session.`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.log(`  [memory] finalization failed (continuing anyway): ${message}`);
    }
  }

  console.log("Coding agent — type /help for commands, or just start chatting.\n");

  try {
    while (true) {
      const line = (await rl.question(sessionId ? "> " : "(no session) > ")).trim();
      if (!line) continue;

      if (line === "/exit") {
        await finalizeCurrentSession();
        break;
      }

      if (line === "/help") {
        printHelp();
        continue;
      }

      if (line === "/sessions") {
        const sessions = store.listSessions();
        if (sessions.length === 0) {
          console.log("No sessions yet.");
        } else {
          for (const s of sessions) {
            console.log(`${s.id}  ${s.label ?? "(no label)"}  ${s.createdAt}`);
          }
        }
        continue;
      }

      if (line.startsWith("/new")) {
        await finalizeCurrentSession();
        const raw = line.slice(4).trim();
        const label = raw.replace(/^["'""]|["'""]$/g, "") || undefined;
        const record = store.createSession(label);
        sessionId = record.id;
        console.log(`Started session ${record.id}${label ? ` ("${label}")` : ""}.`);
        continue;
      }

      if (line.startsWith("/resume")) {
        const id = line.slice(7).trim();
        if (!id) {
          console.log("Usage: /resume <session-id>");
          continue;
        }
        const existing = store.listSessions().find((s) => s.id === id || s.id.startsWith(id));
        if (!existing) {
          console.log(`No session found matching "${id}".`);
          continue;
        }
        await finalizeCurrentSession();
        sessionId = existing.id;
        console.log(`Resumed session ${existing.id}${existing.label ? ` ("${existing.label}")` : ""}.`);
        continue;
      }

      if (!sessionId) {
        const record = store.createSession();
        sessionId = record.id;
        console.log(`(auto-started session ${record.id})`);
      }

      const controller = new AbortController();
      const onSigint = () => {
        console.log("\n  [interrupted] cancelling current turn...");
        controller.abort();
      };
      process.once("SIGINT", onSigint);

      try {
        const finalMessage = await runSession({
          store,
          sessionId,
          provider,
          tools: TOOLS,
          systemPrompt: SYSTEM_PROMPT,
          userMessage: line,
          contextBudget: DEFAULT_CONTEXT_BUDGET,
          signal: controller.signal,
          retrieveContext: async (userMessage) => {
            const memories = retrieveMemories(memoryStore, { scope: MEMORY_SCOPE, query: userMessage });
            return formatMemoryContext(memories);
          },
          onToolCall: (name, input, result) => {
            const preview = result.length > 200 ? `${result.slice(0, 200)}...` : result;
            console.log(`  [tool: ${name}] ${JSON.stringify(input)} -> ${preview}`);
          },
          onCompact: (before, after) => {
            console.log(`  [compacted] ${before} messages -> ${after} messages`);
          },
        });
        console.log(`\n${finalMessage}\n`);
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") {
          console.log("Cancelled — back at the prompt. Your progress up to that point was saved.\n");
        } else {
          const message = err instanceof Error ? err.message : String(err);
          console.error(`Error: ${message}`);
        }
      } finally {
        process.removeListener("SIGINT", onSigint);
      }
    }
  } finally {
    rl.close();
    store.close();
    memoryStore.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});