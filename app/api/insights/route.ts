import { NextRequest, NextResponse } from "next/server";
import { getData } from "@/lib/data-fetcher";
import { generateInsights } from "@/lib/insights-generator";
import { AIProviderType } from "@/lib/ai-provider";
import { Insight } from "@/lib/types";
import { getClientKey, checkRateLimit } from "@/lib/rate-limit";

const INSIGHTS_COOLDOWN_MS = 3_000;
const INSIGHTS_RATE_TTL_MS = 60_000;
const insightsLastRequest = new Map<string, number>();

function filterInsightsByTime(insights: Insight[], start: string, end: string): Insight[] {
  const s = new Date(start).getTime();
  const e = new Date(end).getTime();
  if (isNaN(s) || isNaN(e)) return insights;
  return insights.filter((i) => {
    const d = new Date(i.createdAt || "").getTime();
    if (isNaN(d)) return true; // keep if undated
    return d >= s && d <= e;
  });
}

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  if (checkRateLimit(insightsLastRequest, clientKey, INSIGHTS_COOLDOWN_MS, INSIGHTS_RATE_TTL_MS)) {
    return NextResponse.json({ insights: [], isDemo: false, error: "Too many requests" }, { status: 429 });
  }

  try {
    const useDemoData = req.headers.get("x-use-demo") !== "false";
    const pbKey = req.headers.get("x-productboard-key") || undefined;
    const attKey = req.headers.get("x-attention-key") || undefined;
    const pendoKey = req.headers.get("x-pendo-integration-key") || undefined;
    const geminiKey = req.headers.get("x-gemini-key") || undefined;
    const atlDomain = req.headers.get("x-atlassian-domain") || undefined;
    const atlEmail = req.headers.get("x-atlassian-email") || undefined;
    const atlToken = req.headers.get("x-atlassian-token") || undefined;
    const aiProvider = (req.headers.get("x-ai-provider") as AIProviderType) || undefined;
    const anthropicKey = req.headers.get("x-anthropic-key") || undefined;
    const openaiKey = req.headers.get("x-openai-key") || undefined;
    const aiModel = req.headers.get("x-ai-model") || undefined;

    const amplitudeKey = req.headers.get("x-amplitude-key") || undefined;
    const posthogKey = req.headers.get("x-posthog-key") || undefined;
    const posthogHost = req.headers.get("x-posthog-host") || undefined;
    const analyticsProvider = (req.headers.get("x-analytics-provider") as "pendo" | "amplitude" | "posthog") || undefined;
    const linearKey = req.headers.get("x-linear-key") || undefined;
    const linearTeamId = req.headers.get("x-linear-team-id") || undefined;

    const hasPb = !!(pbKey || process.env.PRODUCTBOARD_API_TOKEN);
    const hasAtt = !!(attKey || process.env.ATTENTION_API_KEY);
    const hasPendo = !!(pendoKey || process.env.PENDO_INTEGRATION_KEY);
    const hasAmplitude = !!(amplitudeKey || process.env.AMPLITUDE_API_KEY);
    const hasPostHog = !!(posthogKey || process.env.POSTHOG_API_KEY);
    const hasAtl = !!(atlDomain && atlEmail && atlToken) || !!(process.env.ATLASSIAN_DOMAIN && process.env.ATLASSIAN_EMAIL && process.env.ATLASSIAN_API_TOKEN);
    const hasLinear = !!(linearKey || process.env.LINEAR_API_KEY);
    const hasAnyLiveKey = hasPb || hasAtt || hasPendo || hasAmplitude || hasPostHog || hasAtl || hasLinear;

    if (!hasAnyLiveKey && !useDemoData) {
      return NextResponse.json({ insights: [], isDemo: false });
    }

    const isDemo = !hasAnyLiveKey && useDemoData;
    const atlJiraFilter = req.headers.get("x-atlassian-jira-filter") || undefined;
    const atlConfluenceFilter = req.headers.get("x-atlassian-confluence-filter") || undefined;
    const timeStart = req.headers.get("x-time-start") || undefined;
    const timeEnd = req.headers.get("x-time-end") || undefined;

    const data = await getData(pbKey, attKey, pendoKey, useDemoData, atlDomain, atlEmail, atlToken, atlJiraFilter, atlConfluenceFilter, analyticsProvider, amplitudeKey, posthogKey, undefined, posthogHost, linearKey, linearTeamId);
    let insights = await generateInsights(data, geminiKey, aiProvider, anthropicKey, openaiKey, aiModel);

    // Apply time filter if provided (filters insights whose lastSeen/firstSeen falls in range)
    if (timeStart && timeEnd) {
      insights = filterInsightsByTime(insights, timeStart, timeEnd);
    }

    return NextResponse.json({ insights, isDemo });
  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json({ insights: [], isDemo: false, error: "Failed to generate insights" }, { status: 500 });
  }
}
