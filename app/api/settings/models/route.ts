import { NextRequest, NextResponse } from "next/server";
import { getAIProvider, AIProviderType } from "@/lib/ai-provider";

export async function GET(req: NextRequest) {
  try {
    const provider = (req.nextUrl.searchParams.get("provider") || "gemini") as AIProviderType;

    const keyMap: Record<AIProviderType, { header: string; env: string }> = {
      gemini: { header: "x-gemini-key", env: "GEMINI_API_KEY" },
      anthropic: { header: "x-anthropic-key", env: "ANTHROPIC_API_KEY" },
      openai: { header: "x-openai-key", env: "OPENAI_API_KEY" },
    };

    const cfg = keyMap[provider] || keyMap.gemini;
    const key = req.headers.get(cfg.header) || process.env[cfg.env] || undefined;

    const aiProvider = getAIProvider(provider);
    const models = await aiProvider.listModels(key);

    return NextResponse.json({ provider, models });
  } catch (error) {
    console.error("Models API error:", error);
    return NextResponse.json({ provider: "unknown", models: [] }, { status: 500 });
  }
}
