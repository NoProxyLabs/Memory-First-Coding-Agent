export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  onRetry?: (attempt: number, delayMs: number, error: unknown) => void;
  signal?: AbortSignal;
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (isAbortError(err)) return false;
  const statusMatch = err.message.match(/Groq API error (\d+)/);
  if (statusMatch) {
    const status = Number(statusMatch[1]);
    return status === 429 || status >= 500;
  }
  return /fetch failed|ECONNRESET|ETIMEDOUT/i.test(err.message);
}

function parseRetryAfterSeconds(err: unknown): number | null {
  if (!(err instanceof Error)) return null;
  const match = err.message.match(/try again in ([\d.]+)s/i);
  return match ? parseFloat(match[1]) : null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

export async function withRetry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const { maxRetries = 4, baseDelayMs = 1000, onRetry, signal } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxRetries || !isRetryable(err)) {
        throw err;
      }

      const suggestedSeconds = parseRetryAfterSeconds(err);
      const delayMs =
        suggestedSeconds !== null
          ? Math.ceil(suggestedSeconds * 1000) + 200
          : baseDelayMs * 2 ** attempt;

      onRetry?.(attempt + 1, delayMs, err);
      await sleep(delayMs, signal);
    }
  }
  throw lastError;
}