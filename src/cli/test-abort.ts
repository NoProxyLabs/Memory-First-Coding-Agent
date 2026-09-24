import { withRetry } from "../core/retry.js";

async function main() {
  const controller = new AbortController();
  const start = Date.now();
  setTimeout(() => controller.abort(), 300);

  try {
    await withRetry(
      async () => {
        throw new Error(
          `Groq API error 429: {"error":{"message":"Please try again in 10s."}}`
        );
      },
      { maxRetries: 5, signal: controller.signal }
    );
    console.log("FAIL: expected an AbortError to be thrown");
  } catch (err) {
    const elapsedMs = Date.now() - start;
    const isAbort = err instanceof Error && err.name === "AbortError";
    console.log(`Elapsed: ${elapsedMs}ms | isAbortError: ${isAbort}`);
    console.log(`PASS: ${isAbort && elapsedMs < 2000 ? "YES" : "NO"}`);
  }
}

main();