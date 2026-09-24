import { readFile } from "node:fs/promises";
import type { Tool } from "./types.js";
import { truncateOutput } from "./truncate.js";

export const readTool: Tool = {
  definition: {
    name: "read_file",
    description: "Read the full contents of a file at the given path.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Relative or absolute file path" },
      },
      required: ["path"],
    },
  },

  async execute(input) {
    const path = input.path;
    if (typeof path !== "string") {
      return "Error: 'path' must be a string.";
    }

    try {
      const contents = await readFile(path, "utf-8");
      return truncateOutput(contents);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return `Error reading file: ${message}`;
    }
  },
};