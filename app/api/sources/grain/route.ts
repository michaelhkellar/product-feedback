import { NextRequest, NextResponse } from "next/server";
import { getGrainCalls, isGrainConfigured } from "@/lib/grain";
import { sanitizeCallsForClient } from "@/lib/call-utils";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-grain-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") === "true";

  const calls = await getGrainCalls(overrideKey, useDemoFallback);

  return NextResponse.json({
    connected: isGrainConfigured(overrideKey),
    // Strip full transcript before serializing to client — it's server-only.
    calls: sanitizeCallsForClient(calls.data),
    callsIsDemo: calls.isDemo,
  });
}
