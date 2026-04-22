const RETRY_ATTEMPTS = 1;
const RETRY_BASE_MS = 1_000;

/** Returns true for transient provider errors that are safe to retry (503, 529, 429). */
export function isTransientProviderError(err: unknown): boolean {
  // Anthropic: APIStatusError with .status; OpenAI: APIError with .status
  const status = (err as { status?: number })?.status;
  if (status === 503 || status === 529 || status === 429) return true;
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return /503|529|429|rate.?limit|overloaded|unavailable|quota/.test(msg);
}

/**
 * Runs fn(), retrying once after a short backoff on transient provider errors.
 * Non-transient errors (auth, not-found, validation) are re-thrown immediately.
 */
export async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isTransientProviderError(err) || attempt >= RETRY_ATTEMPTS) throw err;
      const delay = RETRY_BASE_MS + Math.random() * 500;
      console.warn(`[${label}] transient error (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error("unreachable");
}
