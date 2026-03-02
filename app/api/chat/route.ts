import { NextRequest, NextResponse } from "next/server";
import { chat } from "@/lib/agent";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { message, history, useDemoData } = body;

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Message is required" },
        { status: 400 }
      );
    }

    const keys = {
      geminiKey: req.headers.get("x-gemini-key") || undefined,
      productboardKey: req.headers.get("x-productboard-key") || undefined,
      attentionKey: req.headers.get("x-attention-key") || undefined,
    };

    const result = await chat(
      message,
      Array.isArray(history) ? history : [],
      keys,
      useDemoData !== false
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error("Chat API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
