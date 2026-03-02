import { NextRequest, NextResponse } from "next/server";
import { getData } from "@/lib/data-fetcher";
import { generateInsights } from "@/lib/insights-generator";
import { DEMO_INSIGHTS } from "@/lib/demo-data";

export async function GET(req: NextRequest) {
  try {
    const useDemoData = req.headers.get("x-use-demo") !== "false";
    const pbKey = req.headers.get("x-productboard-key") || undefined;
    const attKey = req.headers.get("x-attention-key") || undefined;
    const geminiKey = req.headers.get("x-gemini-key") || undefined;

    const hasPb = !!(pbKey || process.env.PRODUCTBOARD_API_TOKEN);
    const hasAtt = !!(attKey || process.env.ATTENTION_API_KEY);
    const hasAnyLiveKey = hasPb || hasAtt;

    if (!hasAnyLiveKey && useDemoData) {
      return NextResponse.json({ insights: DEMO_INSIGHTS, isDemo: true });
    }

    if (!hasAnyLiveKey && !useDemoData) {
      return NextResponse.json({ insights: [], isDemo: false });
    }

    const data = await getData(pbKey, attKey, useDemoData);
    const insights = await generateInsights(data, geminiKey);

    return NextResponse.json({
      insights,
      isDemo: false,
      itemCount: {
        feedback: data.feedback.length,
        features: data.features.length,
        calls: data.calls.length,
      },
    });
  } catch (error) {
    console.error("Insights API error:", error);
    return NextResponse.json(
      { insights: [], isDemo: false, error: "Failed to generate insights" },
      { status: 500 }
    );
  }
}
