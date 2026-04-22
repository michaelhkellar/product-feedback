import { GoogleGenerativeAI } from "@google/generative-ai";

const MODEL_CANDIDATES = [
  "gemini-2.5-flash",
  "gemini-2.5-pro",
  "gemini-1.5-flash",
  "gemini-1.5-pro",
];

const clients = new Map<string, GoogleGenerativeAI>();
let resolvedModel: string | null = null;

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
  userPrompt: string
): Promise<string> {
  const model = client.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
  });
  const result = await model.generateContent(userPrompt);
  return result.response.text();
}

export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  overrideKey?: string,
  overrideModel?: string
): Promise<string | null> {
  const client = getClient(overrideKey);
  if (!client) return null;

  if (overrideModel) {
    try {
      return await tryGenerate(client, overrideModel, systemPrompt, userPrompt);
    } catch (err) {
      console.error(`Gemini API error (${overrideModel}):`, err);
      return null;
    }
  }

  if (resolvedModel) {
    try {
      return await tryGenerate(client, resolvedModel, systemPrompt, userPrompt);
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
      const text = await tryGenerate(client, candidate, systemPrompt, userPrompt);
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
      const model = client.getGenerativeModel({ model: candidate });
      await model.generateContent("Say OK");
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
