import { writeFile } from "node:fs/promises";
import type { Tool } from "./types.js";

// Deliberately simple for now: this overwrites the whole file with new
// content. That's fine for creating new files, but risky for editing large
// existing ones — the model has to reproduce the entire file correctly just
// to change one line, which wastes tokens and invites mistakes. Before this
// touches a real codebase (Phase B dogfooding), we should upgrade this to a
// find-and-replace style edit (old_string -> new_string, unique match
// required) instead of full overwrite — the same pattern real coding agents
// use. Flagging now so it doesn't get forgotten once the loop is exciting to
// use.

export const editTool: Tool = {
  definition: {
    name: "write_file",
    description: "Write content to a file, creating it if it doesn't exist or overwriting it if it does.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path to write to" },
        content: { type: "string", description: "Full content to write" },
      },
      required: ["path", "content"],
    },
  },

  async execute(input) {
    const path = input.path;
    const content = input.content;
    if (typeof path !== "string" || typeof content !== "string") {
      return "Error: 'path' and 'content' must both be strings.";
    }

    try {
      await writeFile(path, content, "utf-8");
      return `Wrote ${content.length} characters to ${path}`;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error writing file: ${message}`;
    }
  },
};