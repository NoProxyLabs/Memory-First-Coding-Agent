import { withRetry } from "../core/retry.js";

async function main() {
  let calls = 0;
  const retryLog: Array<{ attempt: number; delayMs: number }> = [];

  const result = await withRetry(
    async () => {
      calls++;
      if (calls <= 2) {
        throw new Error(
          `Groq API error 429: {"error":{"message":"Rate limit reached... Please try again in 0.05s."}}`
        );
      }
      return "success";
    },
    {
      baseDelayMs: 10,
      onRetry: (attempt, delayMs) => retryLog.push({ attempt, delayMs }),
    }
  );

  console.log("Case 1 — result:", result, "| calls:", calls, "| retries logged:", retryLog.length);
  console.log(
    "Case 1 PASS:",
    result === "success" && calls === 3 && retryLog.length === 2 ? "YES" : "NO"
  );

  let case2Calls = 0;
  try {
    await withRetry(
      async () => {
        case2Calls++;
        throw new Error(`Groq API error 400: bad request`);
      },
      { baseDelayMs: 10 }
    );
    console.log("Case 2 FAIL: expected an error to be thrown");
  } catch {
    console.log("Case 2 — calls made:", case2Calls);
    console.log("Case 2 PASS:", case2Calls === 1 ? "YES" : "NO");
  }
}

main();