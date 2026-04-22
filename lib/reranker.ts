import { VectorDocument } from "./vector-store";
import { AIProviderType, getAIProvider } from "./ai-provider";
import { RERANK } from "./ai-presets";

const CHEAP_RERANK_MODELS: Record<AIProviderType, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash-lite",
};

export interface RerankCandidate {
  document: VectorDocument;
  score: number;
}

export function shouldRerank(
  query: string,
  results: RerankCandidate[],
  isCountQuery: boolean,
  isDrilldownQuery: boolean
): boolean {
  if (results.length < 6) return false;
  if (isCountQuery || isDrilldownQuery) return false; // these need breadth, not precision
  // If top score dominates by 4× the median, the winner is clear
  const top = results[0]?.score ?? 0;
  const med = results[Math.floor(results.length / 2)]?.score ?? 0;
  if (med > 0 && top > med * 4) return false;
  return true;
}

export async function rerankResults(
  query: string,
  candidates: RerankCandidate[],
  aiProvider: AIProviderType,
  aiKey: string | undefined,
  maxResults = 8,
  timeoutMs = 2500
): Promise<RerankCandidate[]> {
  if (candidates.length === 0) return candidates;

  const model = CHEAP_RERANK_MODELS[aiProvider];
  const provider = getAIProvider(aiProvider);
  if (!provider.isConfigured(aiKey)) return candidates;

  const cardLines = candidates.slice(0, 20).map((c, i) => {
    const meta = Object.entries(c.document.metadata)
      .filter(([, v]) => v)
      .slice(0, 2)
      .map(([k, v]) => `${k}:${v}`)
      .join(" ");
    const snippet = c.document.text.slice(0, 120).replace(/\s+/g, " ");
    return `[${i}] ${c.document.type} — ${snippet}${meta ? ` (${meta})` : ""}`;
  });

  const system = "You are a relevance ranker. Output only JSON — no prose.";
  const prompt = `Query: "${query}"

Candidates (0-indexed):
${cardLines.join("\n")}

Return the indices of the most relevant candidates, most-relevant first, max ${maxResults}. Format: {"order":[<integers>]}`;

  try {
    const response = await Promise.race([
      provider.generate(system, prompt, aiKey, model, RERANK),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);

    if (!response) return candidates;

    const cleaned = response.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as { order?: unknown };
    if (!Array.isArray(parsed.order)) return candidates;

    const order = parsed.order
      .filter((n): n is number => typeof n === "number" && n >= 0 && n < candidates.length)
      .slice(0, maxResults);

    if (order.length === 0) return candidates;

    const seen = new Set(order);
    const remaining = candidates
      .map((_, i) => i)
      .filter((i) => !seen.has(i));

    return [...order, ...remaining].map((i) => candidates[i]);
  } catch {
    return candidates; // non-fatal: return original RRF order
  }
}
