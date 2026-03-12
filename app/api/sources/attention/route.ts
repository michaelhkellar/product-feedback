import { NextRequest, NextResponse } from "next/server";
import { getCalls, isAttentionConfigured } from "@/lib/attention";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-attention-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") !== "false";

  const calls = await getCalls(overrideKey, useDemoFallback);

  return NextResponse.json({
    connected: isAttentionConfigured(overrideKey),
    calls: calls.data,
    callsIsDemo: calls.isDemo,
  });
}
