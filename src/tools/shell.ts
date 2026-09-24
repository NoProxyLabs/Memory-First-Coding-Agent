import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { Tool } from "./types.js";
import { truncateOutput } from "./truncate.js";

const execAsync = promisify(exec);

const DANGEROUS_PATTERNS: RegExp[] = [
  /rm\s+-rf/i,
  /git\s+push\s+.*--force/i,
  /git\s+reset\s+--hard/i,
  /del\s+\/s/i,
  /format\s+[a-z]:/i,
  /drop\s+(table|database)/i,
  /sudo\s/i,
  />\s*\/dev\/sd/i,
];

function looksDangerous(command: string): boolean {
  return DANGEROUS_PATTERNS.some((p) => p.test(command));
}

export interface ShellToolOptions {
  confirm?: (command: string) => Promise<boolean>;
}

export function createShellTool(options: ShellToolOptions = {}): Tool {
  return {
    definition: {
      name: "run_shell",
      description: "Run a shell command and return its stdout/stderr.",
      inputSchema: {
        type: "object",
        properties: {
          command: { type: "string", description: "The shell command to run" },
        },
        required: ["command"],
      },
    },

    async execute(input) {
      const command = input.command;
      if (typeof command !== "string") {
        return "Error: 'command' must be a string.";
      }

      if (looksDangerous(command)) {
        const approved = options.confirm ? await options.confirm(command) : false;
        if (!approved) {
          return `Blocked: "${command}" matches a destructive-command pattern and was not confirmed. This is a guardrail against accidental damage, not a security boundary — see shell.ts.`;
        }
      }

      try {
        const { stdout, stderr } = await execAsync(command, { timeout: 15_000 });
        return truncateOutput(stdout || stderr || "(no output)");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Error running command: ${message}`;
      }
    },
  };
}