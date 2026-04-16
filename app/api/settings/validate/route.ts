import { NextRequest, NextResponse } from "next/server";
import { findWorkingModel } from "@/lib/gemini";
import { validateLinearKey } from "@/lib/linear";

export async function POST(req: NextRequest) {
  try {
    const { keyName } = await req.json();

    if (keyName === "anthropicKey") {
      const key = req.headers.get("x-anthropic-key") || process.env.ANTHROPIC_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
          headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        });
        if (res.ok) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    if (keyName === "openaiKey") {
      const key = req.headers.get("x-openai-key") || process.env.OPENAI_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const res = await fetch("https://api.openai.com/v1/models?limit=1", {
          headers: { Authorization: `Bearer ${key}` },
        });
        if (res.ok) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    if (keyName === "amplitudeKey") {
      const key = req.headers.get("x-amplitude-key") || process.env.AMPLITUDE_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      const parts = key.split(":");
      if (parts.length !== 2) return NextResponse.json({ valid: false, error: "Format should be apiKey:secretKey" });
      try {
        const encoded = Buffer.from(`${parts[0]}:${parts[1]}`).toString("base64");
        const res = await fetch("https://amplitude.com/api/2/export?start=20240101T00&end=20240101T01", {
          headers: { Authorization: `Basic ${encoded}` },
        });
        if (res.ok || res.status === 200 || res.status === 204) return NextResponse.json({ valid: true });
        if (res.status === 404) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: `API returned ${res.status}: ${res.statusText}` });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

    if (keyName === "linearKey") {
      const key = req.headers.get("x-linear-key") || process.env.LINEAR_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      try {
        const valid = await validateLinearKey(key);
        if (valid) return NextResponse.json({ valid: true });
        return NextResponse.json({ valid: false, error: "Linear rejected the API key" });
      } catch (err: unknown) {
        return NextResponse.json({ valid: false, error: err instanceof Error ? err.message : "Connection failed" });
      }
    }

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

    if (keyName === "posthogKey") {
      const key = req.headers.get("x-posthog-key") || process.env.POSTHOG_API_KEY;
      if (!key) return NextResponse.json({ valid: false, error: "No key provided" });
      const parts = key.split(":");
      if (parts.length !== 2) return NextResponse.json({ valid: false, error: "Format should be apiKey:projectId" });
      const host = (req.headers.get("x-posthog-host") || process.env.POSTHOG_HOST || "https://app.posthog.com").replace(/\/+$/, "");
      try {
        const res = await fetch(`${host}/api/projects/${parts[1]}/`, {
          headers: { Authorization: `Bearer ${parts[0]}` },
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
