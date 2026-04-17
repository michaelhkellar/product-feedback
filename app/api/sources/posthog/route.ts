import { NextRequest, NextResponse } from "next/server";
import { getPostHogOverview, isPostHogConfigured } from "@/lib/posthog";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-posthog-key") || undefined;
  const host = req.headers.get("x-posthog-host") || undefined;

  if (!isPostHogConfigured(apiKey)) {
    return NextResponse.json({ connected: false, overview: null });
  }

  const overview = await getPostHogOverview(apiKey, undefined, host);

  return NextResponse.json({
    connected: !!overview,
    overview,
  });
}
