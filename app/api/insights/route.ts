import { NextRequest, NextResponse } from "next/server";
import { getData } from "@/lib/data-fetcher";
import { generateInsights } from "@/lib/insights-generator";
import { AIProviderType } from "@/lib/ai-provider";

export async function GET(req: NextRequest) {
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

    const hasPb = !!(pbKey || process.env.PRODUCTBOARD_API_TOKEN);
    const hasAtt = !!(attKey || process.env.ATTENTION_API_KEY);
    const hasPendo = !!(pendoKey || process.env.PENDO_INTEGRATION_KEY);
    const hasAmplitude = !!(amplitudeKey || process.env.AMPLITUDE_API_KEY);
    const hasPostHog = !!(posthogKey || process.env.POSTHOG_API_KEY);
    const hasAtl = !!(atlDomain && atlEmail && atlToken) || !!(process.env.ATLASSIAN_DOMAIN && process.env.ATLASSIAN_EMAIL && process.env.ATLASSIAN_API_TOKEN);
    const hasAnyLiveKey = hasPb || hasAtt || hasPendo || hasAmplitude || hasPostHog || hasAtl;

    if (!hasAnyLiveKey && !useDemoData) {
      return NextResponse.json({ insights: [], isDemo: false });
    }

    const isDemo = !hasAnyLiveKey && useDemoData;
    const atlJiraFilter = req.headers.get("x-atlassian-jira-filter") || undefined;
    const atlConfluenceFilter = req.headers.get("x-atlassian-confluence-filter") || undefined;
    const data = await getData(pbKey, attKey, pendoKey, useDemoData, atlDomain, atlEmail, atlToken, atlJiraFilter, atlConfluenceFilter, analyticsProvider, amplitudeKey, posthogKey, undefined, posthogHost);
    const insights = await generateInsights(data, geminiKey, aiProvider, anthropicKey, openaiKey, aiModel);

    return NextResponse.json({ insights, isDemo });
  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json({ insights: [], isDemo: false, error: "Failed to generate insights" }, { status: 500 });
  }
}
