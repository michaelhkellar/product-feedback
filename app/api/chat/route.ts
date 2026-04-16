import { NextRequest, NextResponse } from "next/server";
import { chat, extractTimeRange, InteractionMode } from "@/lib/agent";
import { getData } from "@/lib/data-fetcher";
import { ContextMode } from "@/lib/api-keys";
import { AIProviderType } from "@/lib/ai-provider";
import { generateProgrammaticInsights } from "@/lib/insights-generator";

const MAX_MESSAGE_LENGTH = 10_000;
const MAX_HISTORY_ITEMS = 50;
const MAX_SOURCE_IDS = 200;
const CHAT_COOLDOWN_MS = 2_000;
const chatLastRequest = new Map<string, number>();

export async function POST(req: NextRequest) {
  try {
    const clientKey = req.headers.get("x-forwarded-for") || req.ip || "unknown";
    const now = Date.now();
    const lastTime = chatLastRequest.get(clientKey) || 0;
    if (now - lastTime < CHAT_COOLDOWN_MS) {
      return NextResponse.json({ error: "Please wait a moment before sending another message" }, { status: 429 });
    }
    chatLastRequest.set(clientKey, now);

    const body = await req.json();
    const { message, useDemoData, contextMode, mode: interactionMode } = body;
    let { history, accumulatedSourceIds } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const trimmedMessage = message.slice(0, MAX_MESSAGE_LENGTH);
    if (Array.isArray(history)) {
      history = history.slice(-MAX_HISTORY_ITEMS);
    }
    if (Array.isArray(accumulatedSourceIds)) {
      accumulatedSourceIds = accumulatedSourceIds.slice(0, MAX_SOURCE_IDS);
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

    const analyticsProvider = (req.headers.get("x-analytics-provider") as "pendo" | "amplitude" | "posthog") || undefined;
    const amplitudeKey = req.headers.get("x-amplitude-key") || undefined;
    const posthogKey = req.headers.get("x-posthog-key") || undefined;

    const posthogHost = req.headers.get("x-posthog-host") || undefined;

    const linearKey = req.headers.get("x-linear-key") || undefined;
    const linearTeamId = req.headers.get("x-linear-team-id") || undefined;

    const agentKeys = {
      ...keys,
      analyticsProvider,
      amplitudeKey,
      posthogKey,
      posthogHost,
      linearKey,
      linearTeamId,
    };

    const timeRange = extractTimeRange(trimmedMessage);
    const analyticsDays = timeRange
      ? Math.min(Math.ceil((timeRange.end.getTime() - timeRange.start.getTime()) / 86400000), 90)
      : undefined;

    const data = await getData(
      keys.productboardKey, keys.attentionKey, keys.pendoKey, useDemoData !== false,
      keys.atlassianDomain, keys.atlassianEmail, keys.atlassianToken,
      req.headers.get("x-atlassian-jira-filter") || undefined,
      req.headers.get("x-atlassian-confluence-filter") || undefined,
      analyticsProvider,
      amplitudeKey,
      posthogKey,
      analyticsDays,
      posthogHost,
      linearKey,
      linearTeamId
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

    const result = await chat(trimmedMessage, Array.isArray(history) ? history : [], dataWithInsights, agentKeys, ctxMode, chatMode, sourceIds);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
