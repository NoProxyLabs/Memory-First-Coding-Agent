import { readdir } from "node:fs/promises";
import type { Tool } from "./types.js";
import { truncateOutput } from "./truncate.js";

export const listDirectoryTool: Tool = {
  definition: {
    name: "list_directory",
    description: "List files and folders at the given path (defaults to current directory).",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory path, defaults to '.'" },
      },
      required: [],
    },
  },

  async execute(input) {
    const path = typeof input.path === "string" && input.path.length > 0 ? input.path : ".";
    try {
      const entries = await readdir(path, { withFileTypes: true });
      const listing = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .join("\n");
      return truncateOutput(listing);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error listing directory: ${message}`;
    }
  },
};