import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";

export async function POST(req: NextRequest) {
  try {
    const { keyName } = await req.json();

    if (keyName === "geminiKey") {
      const key = req.headers.get("x-gemini-key") || process.env.GEMINI_API_KEY;
      if (!key) {
        return NextResponse.json({ valid: false, error: "No key provided" });
      }
      try {
        const genAI = new GoogleGenerativeAI(key);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        await model.generateContent("Say OK");
        return NextResponse.json({ valid: true });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Invalid key";
        return NextResponse.json({ valid: false, error: message });
      }
    }

    if (keyName === "productboardKey") {
      const key =
        req.headers.get("x-productboard-key") ||
        process.env.PRODUCTBOARD_API_TOKEN;
      if (!key) {
        return NextResponse.json({ valid: false, error: "No key provided" });
      }
      try {
        const res = await fetch("https://api.productboard.com/features", {
          headers: {
            Authorization: `Bearer ${key}`,
            "X-Version": "1",
            "Content-Type": "application/json",
          },
        });
        if (res.ok || res.status === 200) {
          return NextResponse.json({ valid: true });
        }
        return NextResponse.json({
          valid: false,
          error: `API returned ${res.status}: ${res.statusText}`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Connection failed";
        return NextResponse.json({ valid: false, error: message });
      }
    }

    if (keyName === "attentionKey") {
      const key =
        req.headers.get("x-attention-key") || process.env.ATTENTION_API_KEY;
      if (!key) {
        return NextResponse.json({ valid: false, error: "No key provided" });
      }
      try {
        const res = await fetch("https://api.attention.tech/v1/conversations", {
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
        });
        if (res.ok || res.status === 200) {
          return NextResponse.json({ valid: true });
        }
        return NextResponse.json({
          valid: false,
          error: `API returned ${res.status}: ${res.statusText}`,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Connection failed";
        return NextResponse.json({ valid: false, error: message });
      }
    }

    return NextResponse.json({ valid: false, error: "Unknown key name" });
  } catch (error) {
    console.error("Validation error:", error);
    return NextResponse.json(
      { valid: false, error: "Validation failed" },
      { status: 500 }
    );
  }
}
