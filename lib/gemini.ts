import { GoogleGenerativeAI } from "@google/generative-ai";

let genAI: GoogleGenerativeAI | null = null;

function getClient(): GoogleGenerativeAI | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  if (!genAI) genAI = new GoogleGenerativeAI(key);
  return genAI;
}

export async function generateWithGemini(
  systemPrompt: string,
  userPrompt: string
): Promise<string | null> {
  const client = getClient();
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

export function isGeminiConfigured(): boolean {
  return !!process.env.GEMINI_API_KEY;
}
