import { exec } from "node:child_process";
import { promisify } from "node:util";

const execAsync = promisify(exec);

export async function getSessionDiff(cwd: string = "."): Promise<string> {
  try {
    const { stdout } = await execAsync("git diff", {
      cwd,
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch {
    return "";
  }
}