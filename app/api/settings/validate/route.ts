import { NextRequest, NextResponse } from "next/server";
import { findWorkingModel } from "@/lib/gemini";

export async function POST(req: NextRequest) {
  try {
    const { keyName } = await req.json();

    if (keyName === "geminiKey") {
      const key = req.headers.get("x-gemini-key") || process.env.GEMINI_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const model = await findWorkingModel(key);
        if (model) return NextResponse.json({ valid: true, model });
        return NextResponse.json({ valid: false, error: "No compatible Gemini model found" });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Invalid key" });
      }
    }

    if (keyName === "productboardKey") {
      const key = req.headers.get("x-productboard-key") || process.env.PRODUCTBOARD_API_TOKEN;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const res = await fetch("https://api.productboard.com/features?pageLimit=1", {
          headers: { Authorization: `Bearer ${key}`, "X-Version": "1", "Content-Type": "application/json" },
        });
        if (res.ok) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    if (keyName === "attentionKey") {
      const key = req.headers.get("x-attention-key") || process.env.ATTENTION_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const res = await fetch("https://api.attention.tech/v1/conversations", {
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        });
        if (res.ok) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    if (keyName === "atlassianToken") {
      const domain = req.headers.get("x-atlassian-domain") || process.env.ATLASSIAN_DOMAIN;
      const email = req.headers.get("x-atlassian-email") || process.env.ATLASSIAN_EMAIL;
      const token = req.headers.get("x-atlassian-token") || process.env.ATLASSIAN_API_TOKEN;
      if (!domain || !email || !token) {
        return NextResponse.json({ valid: false, error: "Domain, email, and token are all required" });
      }
      try {
        const cleanDomain = domain.replace(/\.atlassian\.net\/?$/, "").replace(/^https?:\/\//, "");
        const encoded = Buffer.from(`${email}:${token}`).toString("base64");
        const res = await fetch(`https://${cleanDomain}.atlassian.net/rest/api/3/myself`, {
          headers: { Authorization: `Basic ${encoded}`, Accept: "application/json" },
        });
        if (res.ok) {
          const user = await res.json();
          return NextResponse.json({ valid: true, user: user.displayName || user.emailAddress });
        }
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    return NextResponse.json({ valid: false, error: "Unknown key name" });
  } catch (error) {
    console.error("Validation error:", error);
    return NextResponse.json({ valid: false, error: "Validation failed" }, { status: 500 });
  }
}
