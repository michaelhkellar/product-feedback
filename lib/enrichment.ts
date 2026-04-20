import { FeedbackItem, Sentiment } from "./types";
import { AIProviderType, getAIProvider, resolveAIKey } from "./ai-provider";
import { createHash } from "crypto";

interface EnrichmentResult {
  id: string;
  sentiment: Sentiment;
  themes: string[];
}

interface CachedEnrichment {
  results: Map<string, EnrichmentResult>;
  timestamp: number;
}

const enrichmentCache = new Map<string, CachedEnrichment>();
const ENRICHMENT_TTL_MS = 30 * 60 * 1000;
const ENRICHMENT_CACHE_MAX = 200;
const BATCH_SIZE = 40;

function enrichCacheSet(k: string, v: CachedEnrichment): void {
  enrichmentCache.delete(k);
  enrichmentCache.set(k, v);
  if (enrichmentCache.size > ENRICHMENT_CACHE_MAX) enrichmentCache.delete(enrichmentCache.keys().next().value as string);
}

const CHEAP_MODELS: Record<AIProviderType, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
};

function cacheKey(ids: string[]): string {
  return createHash("sha256").update([...ids].sort().join(",")).digest("hex").slice(0, 20);
}

async function enrichBatch(
  items: Pick<FeedbackItem, "id" | "title" | "content" | "themes">[],
  aiProvider: AIProviderType,
  aiKey: string | undefined
): Promise<EnrichmentResult[]> {
  const provider = getAIProvider(aiProvider);
  const model = CHEAP_MODELS[aiProvider];

  const system = "You are a precise product feedback classifier. Respond only with valid JSON — no markdown, no explanation.";
  const prompt = `Classify each customer feedback item. Return a JSON array only.

For each item output: {"id":"<id>","sentiment":"<positive|negative|neutral|mixed>","themes":["<theme>",…]}
- themes: 2–5 short phrases (e.g. "SSO login", "slow exports", "missing API docs")
- Do NOT include meta-phrases like "customer feedback" or "product request"

Items:
${items.map((f) => `ID: ${f.id}\n${f.title}. ${f.content.slice(0, 300)}`).join("\n\n")}

JSON array:`;

  const response = await provider.generate(system, prompt, aiKey, model);
  if (!response) return [];

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as { id: string; sentiment: string; themes: unknown }[];
    const valid: Sentiment[] = ["positive", "negative", "neutral", "mixed"];
    return parsed.map((r) => ({
      id: r.id,
      sentiment: (valid.includes(r.sentiment as Sentiment) ? r.sentiment : "neutral") as Sentiment,
      themes: Array.isArray(r.themes)
        ? r.themes.slice(0, 5).map((t) => String(t).slice(0, 60))
        : [],
    }));
  } catch {
    return [];
  }
}

export async function enrichFeedback(
  feedback: FeedbackItem[],
  aiProvider: AIProviderType | undefined,
  geminiKey: string | undefined,
  anthropicKey: string | undefined,
  openaiKey: string | undefined
): Promise<FeedbackItem[]> {
  const provider: AIProviderType = aiProvider || "gemini";
  const aiKey = resolveAIKey(provider, geminiKey, anthropicKey, openaiKey);

  if (!getAIProvider(provider).isConfigured(aiKey)) return feedback;

  // Only enrich items that are still "neutral" with sparse themes (API-tagged items are left alone)
  const needsEnrichment = feedback.filter(
    (f) => f.sentiment === "neutral" || f.themes.length < 2
  );
  if (needsEnrichment.length === 0) return feedback;

  const key = cacheKey(needsEnrichment.map((f) => f.id));
  const cached = enrichmentCache.get(key);
  if (cached && Date.now() - cached.timestamp < ENRICHMENT_TTL_MS) {
    return applyEnrichment(feedback, cached.results);
  }

  const results = new Map<string, EnrichmentResult>();

  for (let i = 0; i < needsEnrichment.length; i += BATCH_SIZE) {
    try {
      const batch = needsEnrichment.slice(i, i + BATCH_SIZE);
      const enriched = await enrichBatch(batch, provider, aiKey);
      for (const r of enriched) results.set(r.id, r);
    } catch (err) {
      console.warn(`Enrichment batch ${i / BATCH_SIZE + 1} failed:`, err);
    }
  }

  enrichCacheSet(key, { results, timestamp: Date.now() });
  return applyEnrichment(feedback, results);
}

function applyEnrichment(
  feedback: FeedbackItem[],
  results: Map<string, EnrichmentResult>
): FeedbackItem[] {
  return feedback.map((f) => {
    const r = results.get(f.id);
    if (!r) return f;
    return {
      ...f,
      sentiment: r.sentiment,
      themes: Array.from(new Set([...f.themes, ...r.themes])),
    };
  });
}
