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

    if (keyName === "pendoKey") {
      const key = req.headers.get("x-pendo-integration-key") || process.env.PENDO_INTEGRATION_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const res = await fetch("https://app.pendo.io/api/v1/token/verify", {
          headers: {
            "x-pendo-integration-key": key,
            "Content-Type": "application/json",
          },
        });
        if (res.ok) {
          const details = await res.json().catch(() => null);
          return NextResponse.json({
            valid: true,
            writeAccess: !!details?.writeAccess,
          });
        }
        if (res.status === 403) {
          return NextResponse.json({ valid: false, error: "Pendo rejected the integration key" });
        }
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
        const authHeader = `Basic ${encoded}`;

        const classicRes = await fetch(`https://${cleanDomain}.atlassian.net/rest/api/3/myself`, {
          headers: { Authorization: authHeader, Accept: "application/json" },
        }).catch(() => null);

        if (classicRes?.ok) {
          const user = await classicRes.json();
          return NextResponse.json({ valid: true, user: user.displayName || user.emailAddress, mode: "classic" });
        }

        let cloudId: string | null = null;
        try {
          const tenantRes = await fetch(`https://${cleanDomain}.atlassian.net/_edge/tenant_info`);
          if (tenantRes.ok) {
            const tenant = await tenantRes.json();
            cloudId = tenant.cloudId || null;
          }
        } catch { /* ignore */ }

        if (cloudId) {
          const scopedRes = await fetch(`https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`, {
            headers: { Authorization: authHeader, Accept: "application/json" },
          }).catch(() => null);

          if (scopedRes?.ok) {
            const user = await scopedRes.json();
            return NextResponse.json({ valid: true, user: user.displayName || user.emailAddress, mode: "scoped" });
          }

          if (scopedRes) {
            return NextResponse.json({
              valid: false,
              error: `Scoped token returned ${scopedRes.status}. Ensure your token has read:jira-work and read:confluence-content.all scopes.`,
            });
          }
        }

        const status = classicRes?.status || "unknown";
        return NextResponse.json({
          valid: false,
          error: `Auth failed (${status}). For classic tokens: check email + token. For scoped tokens: ensure read:jira-work scope is enabled.`,
        });
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
