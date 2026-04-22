import { GoogleGenAI, ApiError } from "@google/genai";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

const clients = new Map<string, GoogleGenAI>();
let resolvedModel: string | null = null;

const GENERATE_TIMEOUT_MS = 30_000;
const RETRY_ATTEMPTS = 1;
const RETRY_BASE_MS = 1_000;

function isTransientError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 503 || err.status === 429;
  const msg = err instanceof Error ? err.message.toLowerCase() : "";
  return /503|429|rate.?limit|overloaded|unavailable|quota/.test(msg);
}

export interface GeminiGenOpts {
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Returns the appropriate thinkingConfig for the given model, or undefined if
 * the model doesn't support or require it.
 *
 * Rules:
 * - Only Gemini 2.5+ and 3+ series support thinkingConfig (2.0 and earlier don't).
 * - Pro models cannot fully disable thinking (minimum budget 128 on 2.5-pro;
 *   not supported as fully-off on 3-pro) — we leave them alone.
 * - Flash/lite/latest-alias variants that DO support thinking get it disabled:
 *     Gemini 2.5 flash → thinkingBudget: 0
 *     Gemini 3 flash   → thinkingLevel: "minimal"
 * - gemini-flash-latest currently resolves to gemini-2.5-flash server-side.
 *
 * Exported so the streaming path in lib/ai-provider.ts can reuse the same logic
 * without duplicating it.
 */
export function geminiThinkingConfig(modelName: string): Record<string, unknown> | undefined {
  const name = modelName.toLowerCase();
  const isPro = name.includes("pro");
  const isFlashFamily = name.includes("flash") || name.includes("lite") || name.includes("latest");
  // Only 2.5+ and 3+ series (and their -latest aliases) support thinkingConfig
  const supportsThinking =
    /gemini-2\.5/.test(name) ||
    /gemini-3/.test(name) ||
    /gemini-flash-latest|gemini-2\.5-latest/.test(name);

  if (!supportsThinking || isPro || !isFlashFamily) return undefined;
  return /gemini-3/.test(name)
    ? { thinkingLevel: "minimal" as const }
    : { thinkingBudget: 0 };
}

/**
 * Returns generation config fields for the given model + caller options.
 * Flash variants default to "thinking" mode which adds 5-30s latency on simple
 * classification tasks — thinkingBudget:0 / thinkingLevel:"minimal" disables it.
 */
function buildConfig(modelName: string, opts?: GeminiGenOpts) {
  const tc = geminiThinkingConfig(modelName);
  return {
    ...(tc ? { thinkingConfig: tc } : {}),
    ...(opts?.json ? { responseMimeType: "application/json" } : {}),
    ...(opts?.temperature !== undefined ? { temperature: opts.temperature } : {}),
    ...(opts?.maxOutputTokens !== undefined ? { maxOutputTokens: opts.maxOutputTokens } : {}),
  };
}

/** Returns a cached client for the given key, or null if no key is available. */
export function getGeminiClient(overrideKey?: string): GoogleGenAI | null {
  const key = overrideKey || process.env.GEMINI_API_KEY;
  if (!key) return null;
  let client = clients.get(key);
  if (!client) {
    client = new GoogleGenAI({ apiKey: key });
    clients.set(key, client);
  }
  return client;
}

function isModelNotFoundError(err: unknown): boolean {
  if (err instanceof ApiError) return err.status === 404;
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("404") ||
    msg.includes("not found") ||
    msg.includes("is not found") ||
    msg.includes("no longer available")
  );
}

/**
 * Note on cancellation: @google/genai's abortSignal is a CLIENT-SIDE-ONLY
 * operation. Aborting the signal stops this process from waiting, but the
 * Gemini server continues processing the request and you are still billed for
 * the tokens generated. This is unlike Anthropic and OpenAI, where aborting
 * the signal closes the HTTP connection and actually stops server-side work.
 * The timeout here therefore only protects against client-side hangs, not cost.
 */
async function tryGenerate(
  client: GoogleGenAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  opts?: GeminiGenOpts
): Promise<string> {
  // AbortController gates our local await; does not save server-side tokens (see above).
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`Gemini timeout after ${GENERATE_TIMEOUT_MS}ms`)),
    GENERATE_TIMEOUT_MS
  );
  if (opts?.signal) {
    if (opts.signal.aborted) {
      clearTimeout(timer);
      controller.abort(opts.signal.reason);
    } else {
      opts.signal.addEventListener("abort", () => {
        clearTimeout(timer);
        controller.abort((opts.signal as AbortSignal).reason);
      }, { once: true });
    }
  }

  try {
    const cfg = buildConfig(modelName, opts);
    const result = await client.models.generateContent({
      model: modelName,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        ...cfg,
        abortSignal: controller.signal,
      },
    });

    const usage = result.usageMetadata;
    if (usage?.thoughtsTokenCount) {
      console.warn(
        `[gemini] ${modelName} used ${usage.thoughtsTokenCount} thinking tokens — thinkingConfig may have regressed`
      );
    }

    return result.text ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Wraps tryGenerate with a single retry on transient 503/429 errors. */
async function tryGenerateWithRetry(
  client: GoogleGenAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  opts?: GeminiGenOpts
): Promise<string> {
  for (let attempt = 0; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      return await tryGenerate(client, modelName, systemPrompt, userPrompt, opts);
    } catch (err) {
      if (!isTransientError(err) || attempt >= RETRY_ATTEMPTS) throw err;
      const delay = RETRY_BASE_MS + Math.random() * 500;
      console.warn(`[gemini] ${modelName} transient error (attempt ${attempt + 1}), retrying in ${Math.round(delay)}ms...`);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  throw new Error("unreachable");
}

export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  overrideKey?: string,
  overrideModel?: string,
  opts?: GeminiGenOpts
): Promise<string | null> {
  const client = getGeminiClient(overrideKey);
  if (!client) return null;

  if (overrideModel) {
    try {
      return await tryGenerateWithRetry(client, overrideModel, systemPrompt, userPrompt, opts);
    } catch (err) {
      console.error(`Gemini API error (${overrideModel}):`, err);
      return null;
    }
  }

  if (resolvedModel) {
    try {
      return await tryGenerateWithRetry(client, resolvedModel, systemPrompt, userPrompt, opts);
    } catch (err) {
      if (!isModelNotFoundError(err)) {
        console.error(`Gemini API error (${resolvedModel}):`, err);
        return null;
      }
      resolvedModel = null;
    }
  }

  for (const candidate of MODEL_CANDIDATES) {
    try {
      const text = await tryGenerateWithRetry(client, candidate, systemPrompt, userPrompt, opts);
      resolvedModel = candidate;
      console.log(`Gemini: resolved working model → ${candidate}`);
      return text;
    } catch (err) {
      if (isModelNotFoundError(err)) {
        console.warn(`Gemini: model ${candidate} not available, trying next...`);
        continue;
      }
      console.error(`Gemini API error (${candidate}):`, err);
      return null;
    }
  }

  console.error("Gemini: no working model found among candidates:", MODEL_CANDIDATES);
  return null;
}

export async function findWorkingModel(overrideKey?: string): Promise<string | null> {
  const client = getGeminiClient(overrideKey);
  if (!client) return null;

  for (const candidate of MODEL_CANDIDATES) {
    try {
      await client.models.generateContent({
        model: candidate,
        contents: "Say OK",
        config: {
          ...buildConfig(candidate),
          abortSignal: AbortSignal.timeout(10_000),
        },
      });
      resolvedModel = candidate;
      return candidate;
    } catch (err) {
      if (isModelNotFoundError(err)) continue;
      return null;
    }
  }
  return null;
}

export function getResolvedModel(): string | null {
  return resolvedModel;
}

export function isGeminiConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.GEMINI_API_KEY);
}
