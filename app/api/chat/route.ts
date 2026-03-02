import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/agent";
import { getData } from "@/lib/data-fetcher";
import { generateInsights } from "@/lib/insights-generator";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history, useDemoData } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }

    const keys = {
      geminiKey: req.headers.get("x-gemini-key") || undefined,
      productboardKey: req.headers.get("x-productboard-key") || undefined,
      attentionKey: req.headers.get("x-attention-key") || undefined,
      atlassianDomain: req.headers.get("x-atlassian-domain") || undefined,
      atlassianEmail: req.headers.get("x-atlassian-email") || undefined,
      atlassianToken: req.headers.get("x-atlassian-token") || undefined,
    };

    const data = await getData(
      keys.productboardKey,
      keys.attentionKey,
      useDemoData !== false,
      keys.atlassianDomain,
      keys.atlassianEmail,
      keys.atlassianToken
    );

    if (data.insights.length === 0 && (data.feedback.length > 0 || data.features.length > 0 || data.jiraIssues.length > 0)) {
      try {
        data.insights = await generateInsights(data, keys.geminiKey);
      } catch { /* continue */ }
    }

    const result = await chat(message, Array.isArray(history) ? history : [], data, keys);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
