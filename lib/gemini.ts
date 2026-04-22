import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.5-pro",
];

const clients = new Map<string, GoogleGenerativeAI>();
let resolvedModel: string | null = null;

const GENERATE_TIMEOUT_MS = 30_000;

export interface GeminiGenOpts {
  json?: boolean;
  temperature?: number;
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

/**
 * Builds a generationConfig for the given model + caller options.
 * Flash models default to "thinking" mode which adds 5-30s latency on simple tasks.
 * thinkingBudget:0 disables reasoning; @google/generative-ai@0.21.0 types don't expose
 * thinkingConfig or responseMimeType yet — callers cast the result as `never`.
 */
function buildGenerationConfig(modelName: string, opts?: GeminiGenOpts): Record<string, unknown> {
  const config: Record<string, unknown> = {};
  if (/gemini-2\.5-flash/.test(modelName)) {
    config.thinkingConfig = { thinkingBudget: 0 };
  }
  if (opts?.json) config.responseMimeType = "application/json";
  if (opts?.temperature !== undefined) config.temperature = opts.temperature;
  if (opts?.maxOutputTokens !== undefined) config.maxOutputTokens = opts.maxOutputTokens;
  return config;
}

function getClient(overrideKey?: string): GoogleGenerativeAI | null {
  const key = overrideKey || process.env.GEMINI_API_KEY;
  if (!key) return null;
  let client = clients.get(key);
  if (!client) {
    client = new GoogleGenerativeAI(key);
    clients.set(key, client);
  }
  return client;
}

function isModelNotFoundError(err: unknown): boolean {
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
  client: GoogleGenerativeAI,
  modelName: string,
  systemPrompt: string,
  userPrompt: string,
  opts?: GeminiGenOpts
): Promise<string> {
  const generationConfig = buildGenerationConfig(modelName, opts);
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    // Cast required: @google/generative-ai@0.21.0 types don't include thinkingConfig / responseMimeType
    generationConfig: generationConfig as never,
  });

  // AbortController lets the underlying HTTP request be cancelled on timeout,
  // preventing the SDK call from leaking quota/tokens after we give up.
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
    // requestOptions.signal is supported by the underlying REST client (cast for old types)
    const result = await model.generateContent(userPrompt, { signal: controller.signal } as never);
    const usage = result.response.usageMetadata as { thoughtsTokenCount?: number } | undefined;
    if (usage?.thoughtsTokenCount) {
      console.warn(
        `[gemini] ${modelName} used ${usage.thoughtsTokenCount} thinking tokens — thinkingConfig may have regressed`
      );
    }
    return result.response.text();
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
  const client = getClient(overrideKey);
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
  const client = getClient(overrideKey);
  if (!client) return null;

  for (const candidate of MODEL_CANDIDATES) {
    try {
      const model = client.getGenerativeModel({
        model: candidate,
        generationConfig: buildGenerationConfig(candidate) as never,
      });
      await model.generateContent("Say OK", { signal: AbortSignal.timeout(10_000) } as never);
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
