import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Tool } from "./types.js";
import { truncateOutput } from "./truncate.js";

const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", ".agent"]);

async function searchDir(
  dir: string,
  pattern: RegExp,
  matches: string[],
  maxMatches: number
): Promise<void> {
  if (matches.length >= maxMatches) return;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (matches.length >= maxMatches) return;
    if (IGNORED_DIRS.has(entry.name)) continue;

    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await searchDir(fullPath, pattern, matches, maxMatches);
    } else if (entry.isFile()) {
      try {
        const content = await readFile(fullPath, "utf-8");
        const lines = content.split("\n");
        lines.forEach((line, i) => {
          if (pattern.test(line) && matches.length < maxMatches) {
            matches.push(`${fullPath}:${i + 1}: ${line.trim()}`);
          }
        });
      } catch {
        // Skip binary/unreadable files silently — not every file is text.
      }
    }
  }
}

export const grepTool: Tool = {
  definition: {
    name: "grep",
    description: "Search file contents recursively for a text pattern, starting from a directory.",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Text or regex pattern to search for" },
        path: { type: "string", description: "Directory to search from, defaults to '.'" },
      },
      required: ["pattern"],
    },
  },

  async execute(input) {
    const pattern = input.pattern;
    const path = typeof input.path === "string" ? input.path : ".";
    if (typeof pattern !== "string") {
      return "Error: 'pattern' must be a string.";
    }

    try {
      const regex = new RegExp(pattern);
      const matches: string[] = [];
      await searchDir(path, regex, matches, 50);
      return matches.length > 0 ? truncateOutput(matches.join("\n")) : "No matches found.";
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error searching: ${message}`;
    }
  },
};