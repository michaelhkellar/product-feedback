import { FeedbackItem, Sentiment } from "./types";
import { AIProviderType, getAIProvider, resolveAIKey } from "./ai-provider";
import { isNoiseTheme } from "./theme-utils";
import { createHash } from "crypto";

interface EnrichmentResult {
  id: string;
  sentiment: Sentiment;
  themes: string[];
  urgency: "high" | "medium" | "low";
  actionability: "high" | "medium" | "low";
  topicArea: string;
  confidence: number;
}

interface CachedEnrichment {
  results: Map<string, EnrichmentResult>;
  timestamp: number;
}

const enrichmentCache = new Map<string, CachedEnrichment>();
const ENRICHMENT_TTL_MS = 30 * 60 * 1000;
const ENRICHMENT_CACHE_MAX = 200;
const BATCH_SIZE = 25;
const MAX_CONCURRENT_BATCHES = 3;
const MAX_ENRICH_ITEMS = 75;
const TOTAL_ENRICH_TIMEOUT_MS = 60_000;

function enrichCacheSet(k: string, v: CachedEnrichment): void {
  enrichmentCache.delete(k);
  enrichmentCache.set(k, v);
  if (enrichmentCache.size > ENRICHMENT_CACHE_MAX) enrichmentCache.delete(enrichmentCache.keys().next().value as string);
}

const CHEAP_MODELS: Record<AIProviderType, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  gemini: "gemini-2.5-flash",
};

const ENRICHMENT_SCHEMA_VERSION = "v2";

function cacheKey(ids: string[], modelId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256").update([...ids].sort().join(",") + "|" + modelId + "|" + today + "|" + ENRICHMENT_SCHEMA_VERSION).digest("hex").slice(0, 20);
}

async function enrichBatch(
  items: Pick<FeedbackItem, "id" | "title" | "content" | "themes">[],
  aiProvider: AIProviderType,
  aiKey: string | undefined
): Promise<EnrichmentResult[]> {
  const provider = getAIProvider(aiProvider);
  const model = CHEAP_MODELS[aiProvider];

  const system = "You are a precise product feedback classifier. Respond only with valid JSON — no markdown, no explanation.";
  const prompt = `Classify each customer feedback item. Return a JSON array matching this exact schema for each item:
{"id":"<id>","sentiment":"positive|negative|neutral|mixed","themes":["<2-5 short phrases>"],"urgency":"high|medium|low","actionability":"high|medium|low","topic_area":"<kebab-case label>","confidence":0.0-1.0}

Rules:
- themes: 2–5 short descriptive phrases (e.g. "SSO login", "slow exports", "missing API docs"). No meta-phrases like "customer feedback".
- urgency: high = blocking/critical pain; medium = notable friction; low = nice-to-have or positive
- actionability: high = clear specific ask; medium = implied need; low = vague or praise only
- topic_area: one kebab-case label (e.g. "onboarding", "api-integrations", "billing", "performance", "reporting")
- confidence: how confident you are in this classification (0.0–1.0)

Items:
${items.map((f) => `ID: ${f.id}\n${f.title}. ${f.content.slice(0, 300)}`).join("\n\n")}

JSON array:`;

  const response = await provider.generate(system, prompt, aiKey, model);
  if (!response) return [];

  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];
    const parsed = JSON.parse(jsonMatch[0]) as {
      id: string; sentiment: string; themes: unknown;
      urgency?: string; actionability?: string; topic_area?: string; confidence?: unknown;
    }[];
    const validSentiment: Sentiment[] = ["positive", "negative", "neutral", "mixed"];
    const validLevel = (v: unknown): "high" | "medium" | "low" =>
      v === "high" || v === "low" ? v : "medium";
    return parsed.map((r) => ({
      id: r.id,
      sentiment: (validSentiment.includes(r.sentiment as Sentiment) ? r.sentiment : "neutral") as Sentiment,
      themes: Array.isArray(r.themes) ? r.themes.slice(0, 5).map((t) => String(t).slice(0, 60)) : [],
      urgency: validLevel(r.urgency),
      actionability: validLevel(r.actionability),
      topicArea: typeof r.topic_area === "string" ? r.topic_area.slice(0, 50) : "",
      confidence: typeof r.confidence === "number" ? Math.max(0, Math.min(1, r.confidence)) : 0.7,
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

  // Only enrich items that are still "neutral" with sparse signal themes (API-tagged items are left alone).
  // Noise themes like "5 stars" don't count — otherwise those items get skipped AND keep their noise.
  let needsEnrichment = feedback.filter(
    (f) => f.sentiment === "neutral" || f.themes.filter((t) => !isNoiseTheme(t)).length < 2
  );
  if (needsEnrichment.length === 0) return stripNoiseThemes(feedback);

  // Prioritize most recent items so the first-load cap enriches what users will see first.
  needsEnrichment.sort((a, b) => {
    const da = a.date ? new Date(a.date).getTime() : 0;
    const db = b.date ? new Date(b.date).getTime() : 0;
    return db - da;
  });

  // Cap first-load enrichment so a cold cache can't block the UI indefinitely.
  // Unenriched items keep their existing sentiment/themes — the same fallback used on batch error.
  if (needsEnrichment.length > MAX_ENRICH_ITEMS) {
    console.warn(
      `[enrichment] truncating ${needsEnrichment.length} → ${MAX_ENRICH_ITEMS} items for first-load responsiveness`
    );
    needsEnrichment = needsEnrichment.slice(0, MAX_ENRICH_ITEMS);
  }

  return runEnrichmentBatches(
    needsEnrichment,
    feedback,
    provider,
    aiKey,
    BATCH_SIZE,
    MAX_CONCURRENT_BATCHES,
    TOTAL_ENRICH_TIMEOUT_MS
  );
}

function applyEnrichment(
  feedback: FeedbackItem[],
  results: Map<string, EnrichmentResult>
): FeedbackItem[] {
  return feedback.map((f) => {
    const r = results.get(f.id);
    const sourceThemes = r ? [...f.themes, ...r.themes] : f.themes;
    const themes = Array.from(new Set(sourceThemes)).filter((t) => !isNoiseTheme(t));
    if (!r && themes.length === f.themes.length) return f;
    return {
      ...f,
      sentiment: r ? r.sentiment : f.sentiment,
      themes,
      ...(r ? {
        urgency: r.urgency,
        actionability: r.actionability,
        topicArea: r.topicArea || undefined,
        enrichmentConfidence: r.confidence,
      } : {}),
    };
  });
}

function stripNoiseThemes(feedback: FeedbackItem[]): FeedbackItem[] {
  return feedback.map((f) => {
    const cleaned = f.themes.filter((t) => !isNoiseTheme(t));
    return cleaned.length === f.themes.length ? f : { ...f, themes: cleaned };
  });
}

async function runEnrichmentBatches(
  needsEnrichment: FeedbackItem[],
  allFeedback: FeedbackItem[],
  provider: AIProviderType,
  aiKey: string | undefined,
  batchSize: number,
  maxConcurrent: number,
  totalTimeoutMs: number
): Promise<FeedbackItem[]> {
  const key = cacheKey(needsEnrichment.map((f) => f.id), `${provider}:${CHEAP_MODELS[provider]}`);
  const cached = enrichmentCache.get(key);
  if (cached && Date.now() - cached.timestamp < ENRICHMENT_TTL_MS) {
    return applyEnrichment(allFeedback, cached.results);
  }

  const results = new Map<string, EnrichmentResult>();
  const batches: (typeof needsEnrichment)[] = [];
  for (let i = 0; i < needsEnrichment.length; i += batchSize) {
    batches.push(needsEnrichment.slice(i, i + batchSize));
  }

  console.log(`[enrichment] ${batches.length} batches × ${batchSize} items (${needsEnrichment.length} total)`);
  const enrichStart = Date.now();
  const enrichDeadline = enrichStart + totalTimeoutMs;

  for (let i = 0; i < batches.length; i += maxConcurrent) {
    if (Date.now() >= enrichDeadline) {
      console.warn(`[enrichment] total deadline reached after ${i} batches — skipping remaining`);
      break;
    }
    const chunk = batches.slice(i, i + maxConcurrent);
    const settled = await Promise.allSettled(
      chunk.map((batch) => enrichBatch(batch, provider, aiKey))
    );
    settled.forEach((res, j) => {
      if (res.status === "fulfilled") {
        for (const r of res.value) results.set(r.id, r);
      } else {
        console.warn(`[enrichment] batch ${i + j + 1} failed:`, res.reason);
      }
    });
  }

  console.log(`[enrichment] done in ${((Date.now() - enrichStart) / 1000).toFixed(1)}s`);
  enrichCacheSet(key, { results, timestamp: Date.now() });
  return applyEnrichment(allFeedback, results);
}

/**
 * Lightweight enrichment for a small subset of feedback (e.g. retrieved items during a query).
 * Uses the same cache as enrichFeedback so results are shared.
 */
export async function enrichSubset(
  feedback: FeedbackItem[],
  aiProvider: AIProviderType | undefined,
  geminiKey: string | undefined,
  anthropicKey: string | undefined,
  openaiKey: string | undefined,
  opts: { maxItems?: number; batchSize?: number; totalTimeoutMs?: number } = {}
): Promise<FeedbackItem[]> {
  const provider: AIProviderType = aiProvider || "gemini";
  const aiKey = resolveAIKey(provider, geminiKey, anthropicKey, openaiKey);
  if (!getAIProvider(provider).isConfigured(aiKey)) return feedback;

  const maxItems = opts.maxItems ?? 20;
  const batchSize = opts.batchSize ?? 15;
  const totalTimeoutMs = opts.totalTimeoutMs ?? 10_000;

  let needsEnrichment = feedback.filter(
    (f) => f.sentiment === "neutral" || f.themes.filter((t) => !isNoiseTheme(t)).length < 2
  );
  if (needsEnrichment.length === 0) return feedback;
  if (needsEnrichment.length > maxItems) needsEnrichment = needsEnrichment.slice(0, maxItems);

  return runEnrichmentBatches(
    needsEnrichment,
    feedback,
    provider,
    aiKey,
    batchSize,
    1,
    totalTimeoutMs
  );
}
