import { NextRequest, NextResponse } from "next/server";
import { getInsights } from "@/lib/agent";

export async function GET(req: NextRequest) {
  const useDemoData = req.headers.get("x-use-demo") !== "false";
  const insights = getInsights(useDemoData);
  return NextResponse.json({ insights, isDemo: useDemoData });
}
