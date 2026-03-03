import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/agent";
import { getData } from "@/lib/data-fetcher";
import { ContextMode } from "@/lib/api-keys";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history, useDemoData, contextMode } = body;

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
      keys.productboardKey, keys.attentionKey, useDemoData !== false,
      keys.atlassianDomain, keys.atlassianEmail, keys.atlassianToken,
      req.headers.get("x-atlassian-jira-filter") || undefined,
      req.headers.get("x-atlassian-confluence-filter") || undefined
    );

    const mode: ContextMode = (contextMode === "standard" || contextMode === "deep") ? contextMode : "focused";
    const result = await chat(message, Array.isArray(history) ? history : [], data, keys, mode);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
