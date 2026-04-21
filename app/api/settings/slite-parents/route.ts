import { NextRequest, NextResponse } from "next/server";
import { getSliteTopLevelNotes } from "@/lib/slite";
import { getClientKey, checkRateLimit } from "@/lib/rate-limit";

const COOLDOWN_MS = 2_000;
const RATE_TTL_MS = 60_000;
const lastRequest = new Map<string, number>();

export async function GET(req: NextRequest) {
  const clientKey = getClientKey(req);
  if (checkRateLimit(lastRequest, clientKey, COOLDOWN_MS, RATE_TTL_MS)) {
    return NextResponse.json({ notes: [] }, { status: 429 });
  }

  const key = req.headers.get("x-slite-key") || process.env.SLITE_API_KEY;
  if (!key) {
    return NextResponse.json({ notes: [] });
  }

  try {
    const notes = await getSliteTopLevelNotes(key);
    return NextResponse.json({ notes });
  } catch (error) {
    console.error("Failed to fetch Slite parent notes:", error);
    return NextResponse.json({ notes: [] });
  }
}
