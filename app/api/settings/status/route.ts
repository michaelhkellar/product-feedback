import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const geminiFromHeader = req.headers.get("x-gemini-key");
  const geminiFromEnv = process.env.GEMINI_API_KEY;
  const pbFromHeader = req.headers.get("x-productboard-key");
  const pbFromEnv = process.env.PRODUCTBOARD_API_TOKEN;
  const attFromHeader = req.headers.get("x-attention-key");
  const attFromEnv = process.env.ATTENTION_API_KEY;

  return NextResponse.json({
    status: {
      geminiKey: {
        configured: !!(geminiFromHeader || geminiFromEnv),
        source: geminiFromHeader ? "app" : geminiFromEnv ? "env" : null,
      },
      productboardKey: {
        configured: !!(pbFromHeader || pbFromEnv),
        source: pbFromHeader ? "app" : pbFromEnv ? "env" : null,
      },
      attentionKey: {
        configured: !!(attFromHeader || attFromEnv),
        source: attFromHeader ? "app" : attFromEnv ? "env" : null,
      },
    },
  });
}
