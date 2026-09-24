import { homedir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

const MAX_NAME_LENGTH = 200;

function sanitizePath(targetDir: string): string {
  return targetDir.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function getAgentStateDir(targetDir: string = process.cwd()): string {
  const sanitized = sanitizePath(targetDir);
  const folderName =
    sanitized.length > 0 && sanitized.length <= MAX_NAME_LENGTH
      ? sanitized
      : createHash("sha256").update(targetDir).digest("hex").slice(0, 16);
  return join(homedir(), ".coding-agent", "projects", folderName);
}