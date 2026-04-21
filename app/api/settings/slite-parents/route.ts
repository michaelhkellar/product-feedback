import { NextRequest, NextResponse } from "next/server";
import { getSliteTopLevelNotes } from "@/lib/slite";

export async function GET(req: NextRequest) {
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
