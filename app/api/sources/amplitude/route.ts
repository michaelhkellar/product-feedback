import { NextRequest, NextResponse } from "next/server";
import { getAmplitudeOverview, isAmplitudeConfigured } from "@/lib/amplitude";

export async function GET(req: NextRequest) {
  const apiKey = req.headers.get("x-amplitude-key") || undefined;

  if (!isAmplitudeConfigured(apiKey)) {
    return NextResponse.json({ connected: false, overview: null });
  }

  const overview = await getAmplitudeOverview(apiKey);

  return NextResponse.json({
    connected: !!overview,
    overview,
  });
}
