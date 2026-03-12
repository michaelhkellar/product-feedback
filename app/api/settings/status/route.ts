import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const gemini = req.headers.get("x-gemini-key") || process.env.GEMINI_API_KEY;
  const pb = req.headers.get("x-productboard-key") || process.env.PRODUCTBOARD_API_TOKEN;
  const att = req.headers.get("x-attention-key") || process.env.ATTENTION_API_KEY;
  const pendo = req.headers.get("x-pendo-integration-key") || process.env.PENDO_INTEGRATION_KEY;
  const atlDomain = req.headers.get("x-atlassian-domain") || process.env.ATLASSIAN_DOMAIN;
  const atlEmail = req.headers.get("x-atlassian-email") || process.env.ATLASSIAN_EMAIL;
  const atlToken = req.headers.get("x-atlassian-token") || process.env.ATLASSIAN_API_TOKEN;
  const atlConfigured = !!(atlDomain && atlEmail && atlToken);

  return NextResponse.json({
    status: {
      geminiKey: {
        configured: !!gemini,
        source: req.headers.get("x-gemini-key") ? "app" : process.env.GEMINI_API_KEY ? "env" : null,
      },
      productboardKey: {
        configured: !!pb,
        source: req.headers.get("x-productboard-key") ? "app" : process.env.PRODUCTBOARD_API_TOKEN ? "env" : null,
      },
      attentionKey: {
        configured: !!att,
        source: req.headers.get("x-attention-key") ? "app" : process.env.ATTENTION_API_KEY ? "env" : null,
      },
      pendoKey: {
        configured: !!pendo,
        source: req.headers.get("x-pendo-integration-key") ? "app" : process.env.PENDO_INTEGRATION_KEY ? "env" : null,
      },
      atlassianKey: {
        configured: atlConfigured,
        source: req.headers.get("x-atlassian-token") ? "app" : (process.env.ATLASSIAN_API_TOKEN ? "env" : null),
      },
    },
  });
}
