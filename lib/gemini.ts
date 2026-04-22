import { GoogleGenAI, ApiError } from "@google/genai";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

const clients = new Map<string, GoogleGenAI>();
let resolvedModel: string | null = null;

const GENERATE_TIMEOUT_MS = 30_000;

export interface GeminiGenOpts {
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Returns generation config fields for the given model + caller options.
 * Flash variants default to "thinking" mode which adds 5-30s latency on simple
 * classification tasks; thinkingBudget:0 disables it. Pro models cannot have
 * thinking turned off (minimum budget 128) so we leave them alone.
 */
function buildConfig(modelName: string, opts?: GeminiGenOpts) {
  return {
    ...(/gemini-2\.5-flash/.test(modelName) ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
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

async function tryGenerate(
  client: GoogleGenAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  opts?: GeminiGenOpts
): Promise<string> {
  // Use AbortController so the underlying HTTP request is cancelled on timeout,
  // preventing the call from leaking quota/tokens after we give up.
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
      return await tryGenerate(client, overrideModel, systemPrompt, userPrompt, opts);
    } catch (err) {
      console.error(`Gemini API error (${overrideModel}):`, err);
      return null;
    }
  }

  if (resolvedModel) {
    try {
      return await tryGenerate(client, resolvedModel, systemPrompt, userPrompt, opts);
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
      const text = await tryGenerate(client, candidate, systemPrompt, userPrompt, opts);
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
