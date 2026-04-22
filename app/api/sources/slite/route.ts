import { NextRequest, NextResponse } from "next/server";
import { getSliteNotes, isSliteConfigured } from "@/lib/slite";

export async function GET(req: NextRequest) {
  const overrideKey = req.headers.get("x-slite-key") || undefined;
  const useDemoFallback = req.headers.get("x-use-demo") === "true";

  if (!isSliteConfigured(overrideKey)) {
    return NextResponse.json({ connected: false, notes: [], notesIsDemo: false });
  }

  const notes = await getSliteNotes(overrideKey, useDemoFallback);

  return NextResponse.json({
    connected: true,
    notes: notes.data,
    notesIsDemo: notes.isDemo,
  });
}
