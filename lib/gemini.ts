import { GoogleGenerativeAI } from "@google/generative-ai";

const clients = new Map<string, GoogleGenerativeAI>();

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

export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string,
  overrideKey?: string
): Promise<string | null> {
  const client = getClient(overrideKey);
  if (!client) return null;

  try {
    const model = client.getGenerativeModel({
      model: "gemini-2.0-flash",
      systemInstruction: systemPrompt,
    });

    const result = await model.generateContent(userPrompt);
    return result.response.text();
  } catch (err) {
    console.error("Gemini API error:", err);
    return null;
  }
}

export function isGeminiConfigured(overrideKey?: string): boolean {
  return !!(overrideKey || process.env.GEMINI_API_KEY);
}
