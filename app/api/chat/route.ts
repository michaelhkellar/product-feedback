import { NextRequest, NextResponse } from "next/server";
import { chat, InteractionMode } from "@/lib/agent";
import { getData } from "@/lib/data-fetcher";
import { ContextMode } from "@/lib/api-keys";
import { AIProviderType } from "@/lib/ai-provider";
import { generateProgrammaticInsights } from "@/lib/insights-generator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history, useDemoData, contextMode, mode: interactionMode, accumulatedSourceIds } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const keys = {
      geminiKey: req.headers.get("x-gemini-key") || undefined,
      productboardKey: req.headers.get("x-productboard-key") || undefined,
      attentionKey: req.headers.get("x-attention-key") || undefined,
      pendoKey: req.headers.get("x-pendo-integration-key") || undefined,
      atlassianDomain: req.headers.get("x-atlassian-domain") || undefined,
      atlassianEmail: req.headers.get("x-atlassian-email") || undefined,
      atlassianToken: req.headers.get("x-atlassian-token") || undefined,
      aiProvider: (req.headers.get("x-ai-provider") as AIProviderType) || undefined,
      aiModel: req.headers.get("x-ai-model") || undefined,
      anthropicKey: req.headers.get("x-anthropic-key") || undefined,
      openaiKey: req.headers.get("x-openai-key") || undefined,
    };

    const analyticsProvider = (req.headers.get("x-analytics-provider") as "pendo" | "amplitude") || undefined;
    const amplitudeKey = req.headers.get("x-amplitude-key") || undefined;

    const data = await getData(
      keys.productboardKey, keys.attentionKey, keys.pendoKey, useDemoData !== false,
      keys.atlassianDomain, keys.atlassianEmail, keys.atlassianToken,
      req.headers.get("x-atlassian-jira-filter") || undefined,
      req.headers.get("x-atlassian-confluence-filter") || undefined,
      analyticsProvider,
      amplitudeKey
    );

    const generatedInsights = generateProgrammaticInsights(data);
    const seenInsightIds = new Set(data.insights.map((i) => i.id));
    const mergedInsights = [...data.insights];
    for (const insight of generatedInsights) {
      if (!seenInsightIds.has(insight.id)) {
        mergedInsights.push(insight);
      }
    }
    const dataWithInsights = { ...data, insights: mergedInsights };

    const ctxMode: ContextMode = (contextMode === "standard" || contextMode === "deep") ? contextMode : "focused";
    const chatMode: InteractionMode = (interactionMode === "prd" || interactionMode === "ticket") ? interactionMode : "summarize";
    const sourceIds = Array.isArray(accumulatedSourceIds) ? accumulatedSourceIds : undefined;

    const result = await chat(message, Array.isArray(history) ? history : [], dataWithInsights, keys, ctxMode, chatMode, sourceIds);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
