import { NextRequest, NextResponse } from "next/server";
import { getLinearIssues, isLinearConfigured } from "@/lib/linear";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-linear-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") === "true";
  const teamId = req.headers.get("x-linear-team-id") || undefined;

  const configured = isLinearConfigured(overrideKey);
  const result = await getLinearIssues(overrideKey, teamId, useDemoFallback);

  if (!configured && !result.isDemo) {
    return NextResponse.json({ connected: false, issues: [], issuesIsDemo: false });
  }

  return NextResponse.json({
    connected: configured,
    issues: result.data,
    issuesIsDemo: result.isDemo,
    lastSync: configured ? new Date().toISOString() : undefined,
  });
}
