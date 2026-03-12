import { NextRequest, NextResponse } from "next/server";
import { getPendoOverview, isPendoConfigured } from "@/lib/pendo";

export async function GET(req: NextRequest) {
  const integrationKey = req.headers.get("x-pendo-integration-key") || undefined;

  if (!isPendoConfigured(integrationKey)) {
    return NextResponse.json({ connected: false, overview: null });
  }

  const overview = await getPendoOverview(integrationKey);

  return NextResponse.json({
    connected: !!overview,
    overview,
  });
}
