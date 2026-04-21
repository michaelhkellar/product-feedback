import { NextRequest, NextResponse } from "next/server";
import { getSliteNotes, isSliteConfigured } from "@/lib/slite";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-slite-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") === "true";

  const notes = await getSliteNotes(overrideKey, useDemoFallback);

  return NextResponse.json({
    connected: isSliteConfigured(overrideKey),
    notes: notes.data,
    notesIsDemo: notes.isDemo,
  });
}
