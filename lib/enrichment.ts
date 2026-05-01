import { FeedbackItem, Sentiment, AttentionCall } from "./types";
import { AIProviderType, getAIProvider, resolveAIKey } from "./ai-provider";
import { CLASSIFICATION } from "./ai-presets";
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
const MAX_ENRICH_ITEMS = 100;
const TOTAL_ENRICH_TIMEOUT_MS = 60_000;

function enrichCacheSet(k: string, v: CachedEnrichment): void {
  enrichmentCache.delete(k);
  enrichmentCache.set(k, v);
  if (enrichmentCache.size > ENRICHMENT_CACHE_MAX) enrichmentCache.delete(enrichmentCache.keys().next().value as string);
}

const CHEAP_MODELS: Record<AIProviderType, string> = {
  anthropic: "claude-haiku-4-5-20251001",
  openai: "gpt-4o-mini",
  // flash-lite is purpose-built for classification and faster than flash with thinking off
  gemini: "gemini-2.5-flash-lite",
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

  const response = await provider.generate(system, prompt, aiKey, model, CLASSIFICATION);
  if (!response) return [];

  try {
    const cleaned = response.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
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

  const maxItems = opts.maxItems ?? 25;
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

// ---------- Call signal extraction (Grain transcripts → keyMoments + actionItems + themes + callType) ----------

interface CallSignalResult {
  id: string;
  actionItems: string[];
  keyMoments: { timestamp: string; text: string; sentiment: Sentiment }[];
  themes: string[];
  callType: string;
}

interface CachedCallSignals {
  /** A single CallSignalResult keyed by its own id. Per-call cache entries use single-entry
   * maps for type symmetry with the multi-entry shape used historically. */
  results: Map<string, CallSignalResult>;
  timestamp: number;
}

const callSignalCache = new Map<string, CachedCallSignals>();
// v3 — bump invalidates v2 entries which may have cached empty actionItems
// from the period before Grain native action items were used and the AI prompt
// was loosened. Forces a one-time re-extraction.
const CALL_SIGNAL_SCHEMA_VERSION = "v3";
const CALL_SIGNAL_BATCH_SIZE = 5;
const CALL_SIGNAL_MAX_CONCURRENT = 3;
const CALL_SIGNAL_TOTAL_TIMEOUT_MS = 60_000;
// Front+back biased window of the transcript: action items concentrate at the end of calls,
// opening pain at the start, the middle is often filler.
const TRANSCRIPT_FRONT_CHARS = 4_000;
const TRANSCRIPT_BACK_CHARS = 12_000;
// Call signals get a longer cache TTL than feedback enrichment because transcripts are immutable.
const CALL_SIGNAL_TTL_MS = 24 * 60 * 60 * 1000;
const CALL_SIGNAL_AI_TIMEOUT_MS = 60_000;
const CALL_AGE_LIMIT_MS = 90 * 24 * 60 * 60 * 1000;
const CALL_MIN_CONTENT_CHARS = 500;

const VALID_CALL_TYPES = new Set([
  "qbr",
  "renewal",
  "demo",
  "discovery",
  "customer-support",
  "onboarding",
  "churn-debrief",
  "internal-sync",
  "other",
]);

/**
 * Defensive denylist for AI-extracted theme strings — the prompt instructs the model NOT
 * to use meeting-cadence labels in `themes` (callType is the right home for those), but
 * LLMs occasionally violate. Any theme matching one of these patterns gets dropped.
 * Lowercase comparison; hyphens and spaces both match.
 */
const MEETING_CADENCE_DENYLIST = new Set([
  "weekly-sync",
  "weekly sync",
  "daily-sync",
  "daily sync",
  "dsu",
  "stand-up",
  "standup",
  "qbr",
  "1:1",
  "one-on-one",
  "team-meeting",
  "team meeting",
  "kickoff",
  "kick-off",
  "all-hands",
  "all hands",
  "monthly-sync",
  "monthly sync",
  "office-hours",
  "office hours",
]);

function isMeetingCadenceTheme(theme: string): boolean {
  return MEETING_CADENCE_DENYLIST.has(theme.toLowerCase().trim());
}

function callSignalCacheKey(ids: string[], modelId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update([...ids].sort().join(",") + "|" + modelId + "|" + today + "|" + CALL_SIGNAL_SCHEMA_VERSION)
    .digest("hex")
    .slice(0, 20);
}

function callSignalCacheSet(k: string, v: CachedCallSignals): void {
  callSignalCache.delete(k);
  callSignalCache.set(k, v);
  if (callSignalCache.size > ENRICHMENT_CACHE_MAX) {
    callSignalCache.delete(callSignalCache.keys().next().value as string);
  }
}

/** Front+back window: opening rapport + closing commitments, eliding the middle. Same total
 * token budget as a flat 16K window, but targets the regions where signal lives. */
function biasedTranscriptWindow(text: string): string {
  if (text.length <= TRANSCRIPT_FRONT_CHARS + TRANSCRIPT_BACK_CHARS) return text;
  return (
    text.slice(0, TRANSCRIPT_FRONT_CHARS) +
    "\n\n[…middle of call elided…]\n\n" +
    text.slice(-TRANSCRIPT_BACK_CHARS)
  );
}

async function extractSignalsBatch(
  calls: AttentionCall[],
  aiProvider: AIProviderType,
  aiKey: string | undefined
): Promise<CallSignalResult[]> {
  const provider = getAIProvider(aiProvider);
  const model = CHEAP_MODELS[aiProvider];

  const system =
    "You extract structured customer signals from sales/CS call transcripts. Respond only with valid JSON — no markdown, no explanation.";
  const prompt = `For each call transcript, extract action items, key moments, content themes, and a meeting-type classification. Return a JSON array of:
{"id":"<id>","actionItems":["<short imperative phrase>"],"keyMoments":[{"timestamp":"MM:SS or empty string","text":"<quoted or paraphrased ≤280 chars>","sentiment":"positive|negative|neutral|mixed"}],"themes":["<2–5 short product/topic phrases>"],"callType":"<one allowed value>"}

Rules:
- actionItems: ≤6 entries. Capture concrete commitments, owner-assigned tasks, or specific next steps the team owes the customer. They typically appear after phrases like "next step", "action item", "I'll", "we'll", "we need to", or in the closing minutes of the call. Be liberal — if someone agreed to do X, that's an action item, regardless of phrasing. Phrase concisely (verb-led when natural; noun-phrased like "SSO patch share" or "Roadmap walkthrough" is fine when that's how it was discussed). Skip vague filler like "follow up" or "check in" with no substance.
- keyMoments: ≤6 entries, only sentiment-bearing customer statements. Skip neutral filler. Prefer pain points, praise, deal-breakers, and quotes that name a feature.
- timestamp: extract from transcript like "[12:34]" if present, otherwise empty string.
- themes: 2–5 entries, kebab-case or short noun phrases describing what the call was ABOUT.
  Examples: "sso-failures", "onboarding-friction", "admin-console", "billing-confusion".
  Do NOT include meeting-cadence labels like "weekly-sync", "qbr", "1:1" — those describe
  the CADENCE, not the topic. Use the callType field for that. If the call has no substantive
  topic (pure status check), return [].
- callType: exactly ONE of: "qbr" | "renewal" | "demo" | "discovery" | "customer-support" |
  "onboarding" | "churn-debrief" | "internal-sync" | "other". Distinguish by audience and
  intent: customer-facing vs internal; revenue-stage vs support. "internal-sync" = team-only
  meeting (no external participants). "other" = anything that doesn't fit cleanly.
- If a transcript has no clear actionItems or keyMoments, return them as empty arrays — do not hallucinate.

Transcripts:
${calls
  .map((c) => {
    const sourceText = c.transcript || c.summary;
    const windowed = biasedTranscriptWindow(sourceText);
    return `ID: ${c.id}\nTitle: ${c.title}\nParticipants: ${c.participants.join(", ")}\nTranscript:\n${windowed}`;
  })
  .join("\n\n---\n\n")}

JSON array:`;

  const response = await provider.generate(system, prompt, aiKey, model, {
    ...CLASSIFICATION,
    timeoutMs: CALL_SIGNAL_AI_TIMEOUT_MS,
  });
  if (!response) return [];

  try {
    const cleaned = response.trim().replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(cleaned) as {
      id: string;
      actionItems?: unknown;
      keyMoments?: unknown;
      themes?: unknown;
      callType?: unknown;
    }[];
    const validSentiment: Sentiment[] = ["positive", "negative", "neutral", "mixed"];
    return parsed
      .filter((r) => typeof r.id === "string")
      .map((r) => {
        const actions = Array.isArray(r.actionItems)
          ? r.actionItems
              .slice(0, 6)
              .map((x) => String(x).trim().slice(0, 200))
              .filter((s) => s.length > 0)
          : [];
        const moments = Array.isArray(r.keyMoments)
          ? r.keyMoments
              .slice(0, 6)
              .map((m) => m as { timestamp?: unknown; text?: unknown; sentiment?: unknown })
              .map((m) => ({
                timestamp: typeof m.timestamp === "string" ? m.timestamp.slice(0, 12) : "",
                text: typeof m.text === "string" ? m.text.trim().slice(0, 280) : "",
                sentiment: (validSentiment.includes(m.sentiment as Sentiment) ? m.sentiment : "neutral") as Sentiment,
              }))
              .filter((m) => m.text.length > 0)
          : [];
        const themes = Array.isArray(r.themes)
          ? r.themes
              .slice(0, 5)
              .map((t) => String(t).trim().toLowerCase().slice(0, 60))
              // Drop meeting-cadence labels even if the model emitted them (the prompt
              // tells it not to, but defensive filtering keeps clustering clean).
              .filter((t) => t.length > 0 && !isMeetingCadenceTheme(t))
          : [];
        const rawCallType = typeof r.callType === "string" ? r.callType.toLowerCase().trim() : "";
        const callType = VALID_CALL_TYPES.has(rawCallType) ? rawCallType : "other";
        return { id: r.id, actionItems: actions, keyMoments: moments, themes, callType };
      });
  } catch {
    return [];
  }
}

function applyCallSignals(
  calls: AttentionCall[],
  results: Map<string, CallSignalResult>
): AttentionCall[] {
  return calls.map((c) => {
    const r = results.get(c.id);
    if (!r) return c;
    // Merge AI-extracted content themes with any pre-existing Grain tags, dedupe + denoise.
    const merged = Array.from(new Set([...c.themes, ...r.themes])).filter((t) => !isNoiseTheme(t));
    return {
      ...c,
      actionItems: r.actionItems,
      keyMoments: r.keyMoments,
      themes: merged,
      callType: r.callType,
    };
  });
}

export async function extractCallSignals(
  calls: AttentionCall[],
  aiProvider: AIProviderType | undefined,
  geminiKey: string | undefined,
  anthropicKey: string | undefined,
  openaiKey: string | undefined
): Promise<AttentionCall[]> {
  const provider: AIProviderType = aiProvider || "gemini";
  const aiKey = resolveAIKey(provider, geminiKey, anthropicKey, openaiKey);
  if (!getAIProvider(provider).isConfigured(aiKey)) {
    if (calls.length > 0) {
      console.log(`[call-signals] skipped: no ${provider} key configured (${calls.length} calls would otherwise be processed)`);
    }
    return calls;
  }

  // Skip calls that:
  //  - already have signals populated (Attention path or prior Grain run)
  //  - have too little content to extract from reliably (<500 chars)
  //  - are older than 90 days (rare new value, conserve tokens)
  const ageCutoff = Date.now() - CALL_AGE_LIMIT_MS;
  const reasons = { alreadyHasSignals: 0, tooShort: 0, tooOld: 0 };
  const needsExtraction = calls.filter((c) => {
    if ((c.actionItems?.length ?? 0) > 0 || (c.keyMoments?.length ?? 0) > 0) {
      reasons.alreadyHasSignals++;
      return false;
    }
    const text = (c.transcript || c.summary).trim();
    if (text.length < CALL_MIN_CONTENT_CHARS) {
      reasons.tooShort++;
      return false;
    }
    const callTime = new Date(c.date).getTime();
    if (Number.isFinite(callTime) && callTime < ageCutoff) {
      reasons.tooOld++;
      return false;
    }
    return true;
  });
  const totalSkipped = reasons.alreadyHasSignals + reasons.tooShort + reasons.tooOld;
  if (totalSkipped > 0) {
    const parts: string[] = [];
    if (reasons.alreadyHasSignals > 0) parts.push(`${reasons.alreadyHasSignals} already have signals`);
    if (reasons.tooShort > 0) parts.push(`${reasons.tooShort} too short (<${CALL_MIN_CONTENT_CHARS} chars)`);
    if (reasons.tooOld > 0) parts.push(`${reasons.tooOld} older than 90d`);
    console.log(`[call-signals] skipping ${totalSkipped}/${calls.length} calls: ${parts.join(", ")}`);
  }
  if (needsExtraction.length === 0) {
    if (calls.length > 0) {
      console.log(`[call-signals] no eligible calls to extract from (all ${calls.length} skipped)`);
    }
    return calls;
  }

  // Per-call cache lookup: previously a single batch-level key invalidated the whole set when
  // any call ID changed. With per-call keys, only newly-arrived calls hit the AI on subsequent
  // requests; existing calls stay cached (24h TTL) until tomorrow's date rolls over.
  const modelId = `${provider}:${CHEAP_MODELS[provider]}`;
  const cachedResults = new Map<string, CallSignalResult>();
  const remaining: AttentionCall[] = [];
  for (const c of needsExtraction) {
    const k = callSignalCacheKey([c.id], modelId);
    const hit = callSignalCache.get(k);
    if (hit && Date.now() - hit.timestamp < CALL_SIGNAL_TTL_MS) {
      const r = hit.results.get(c.id);
      if (r) {
        cachedResults.set(c.id, r);
        continue;
      }
    }
    remaining.push(c);
  }

  if (remaining.length === 0) {
    if (cachedResults.size > 0) {
      console.log(`[call-signals] all ${cachedResults.size} calls served from cache`);
    }
    return applyCallSignals(calls, cachedResults);
  }

  const batches: AttentionCall[][] = [];
  for (let i = 0; i < remaining.length; i += CALL_SIGNAL_BATCH_SIZE) {
    batches.push(remaining.slice(i, i + CALL_SIGNAL_BATCH_SIZE));
  }

  console.log(
    `[call-signals] ${batches.length} batches × ${CALL_SIGNAL_BATCH_SIZE} calls ` +
      `(${remaining.length} new, ${cachedResults.size} cached)`
  );
  const start = Date.now();
  const deadline = start + CALL_SIGNAL_TOTAL_TIMEOUT_MS;

  const aiResults = new Map<string, CallSignalResult>();
  for (let i = 0; i < batches.length; i += CALL_SIGNAL_MAX_CONCURRENT) {
    if (Date.now() >= deadline) {
      console.warn(`[call-signals] total deadline reached after ${i} batches — skipping remaining`);
      break;
    }
    const chunk = batches.slice(i, i + CALL_SIGNAL_MAX_CONCURRENT);
    const settled = await Promise.allSettled(chunk.map((b) => extractSignalsBatch(b, provider, aiKey)));
    settled.forEach((res, j) => {
      if (res.status === "fulfilled") {
        // Only cache IDs the model echoed back (partial-batch safety).
        for (const r of res.value) {
          aiResults.set(r.id, r);
          callSignalCacheSet(callSignalCacheKey([r.id], modelId), {
            results: new Map([[r.id, r]]),
            timestamp: Date.now(),
          });
        }
      } else {
        console.warn(`[call-signals] batch ${i + j + 1} failed:`, res.reason);
      }
    });
  }

  // Aggregate result counts to make debugging "0 action items" easy.
  let actionTotal = 0;
  let momentTotal = 0;
  let themeTotal = 0;
  let zeroActionCalls = 0;
  for (const r of aiResults.values()) {
    actionTotal += r.actionItems.length;
    momentTotal += r.keyMoments.length;
    themeTotal += r.themes.length;
    if (r.actionItems.length === 0) zeroActionCalls++;
  }
  console.log(
    `[call-signals] done in ${((Date.now() - start) / 1000).toFixed(1)}s — ` +
      `${aiResults.size} calls extracted: ${actionTotal} action items, ${momentTotal} key moments, ${themeTotal} themes ` +
      `(${zeroActionCalls} call(s) returned 0 action items)`
  );
  if (aiResults.size > 0 && actionTotal === 0) {
    console.warn(
      `[call-signals] WARNING: AI returned 0 action items across all ${aiResults.size} calls. ` +
        `Possible causes: (1) calls genuinely have no commitments (internal syncs, status checks); ` +
        `(2) transcripts are pre-summary marketing/intro content; (3) AI provider issue (check above for batch failures).`
    );
  }

  // Combine cache hits + freshly-extracted results before applying.
  const all = new Map<string, CallSignalResult>(cachedResults);
  for (const [k, v] of aiResults.entries()) all.set(k, v);
  return applyCallSignals(calls, all);
}
