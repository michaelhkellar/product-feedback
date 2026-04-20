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
  const anthropic = req.headers.get("x-anthropic-key") || process.env.ANTHROPIC_API_KEY;
  const openai = req.headers.get("x-openai-key") || process.env.OPENAI_API_KEY;
  const amplitude = req.headers.get("x-amplitude-key") || process.env.AMPLITUDE_API_KEY;
  const linear = req.headers.get("x-linear-key") || process.env.LINEAR_API_KEY;
  const posthog = req.headers.get("x-posthog-key") || process.env.POSTHOG_API_KEY;
  const grain = req.headers.get("x-grain-key") || process.env.GRAIN_API_KEY;

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
      anthropicKey: {
        configured: !!anthropic,
        source: req.headers.get("x-anthropic-key") ? "app" : process.env.ANTHROPIC_API_KEY ? "env" : null,
      },
      openaiKey: {
        configured: !!openai,
        source: req.headers.get("x-openai-key") ? "app" : process.env.OPENAI_API_KEY ? "env" : null,
      },
      amplitudeKey: {
        configured: !!amplitude,
        source: req.headers.get("x-amplitude-key") ? "app" : process.env.AMPLITUDE_API_KEY ? "env" : null,
      },
      linearKey: {
        configured: !!linear,
        source: req.headers.get("x-linear-key") ? "app" : process.env.LINEAR_API_KEY ? "env" : null,
      },
      posthogKey: {
        configured: !!posthog,
        source: req.headers.get("x-posthog-key") ? "app" : process.env.POSTHOG_API_KEY ? "env" : null,
      },
      grainKey: {
        configured: !!grain,
        source: req.headers.get("x-grain-key") ? "app" : process.env.GRAIN_API_KEY ? "env" : null,
      },
    },
  });
}
